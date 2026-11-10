'use strict';

/**
 * One error type for everything the payments layer can throw, so routes/tests
 * only have to understand a single shape.
 *
 *  - retryable:       safe for the CALLER to try again later
 *  - outcomeUnknown:  we sent a state-changing request and never got a definitive
 *                     answer (timeout / network / 5xx). The payment may or may not exist.
 */
class PaymentError extends Error {
  constructor(code, message, opts = {}) {
    super(message);
    this.name = 'PaymentError';
    this.code = code;
    this.httpStatus = opts.httpStatus || 500;
    this.retryable = Boolean(opts.retryable);
    this.outcomeUnknown = Boolean(opts.outcomeUnknown);
    this.debugId = opts.debugId || null;
    this.issues = opts.issues || [];
    if (opts.cause) this.cause = opts.cause;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        retryable: this.retryable,
        outcome_unknown: this.outcomeUnknown,
        debug_id: this.debugId,
        issues: this.issues,
      },
    };
  }
}

// PayPal "details[].issue" values we give a friendly, stable code to.
const ISSUE_MAP = {
  ORDER_NOT_APPROVED: ['ORDER_NOT_APPROVED', 409],
  ORDER_ALREADY_CAPTURED: ['ORDER_ALREADY_CAPTURED', 409],
  PAYER_ACTION_REQUIRED: ['PAYER_ACTION_REQUIRED', 409],
  INSTRUMENT_DECLINED: ['PAYMENT_DECLINED', 402],
  TRANSACTION_REFUSED: ['PAYMENT_REFUSED', 402],
  DUPLICATE_INVOICE_ID: ['DUPLICATE_INVOICE_ID', 409],
  INVALID_CURRENCY_CODE: ['INVALID_CURRENCY', 400],
  CURRENCY_NOT_SUPPORTED: ['INVALID_CURRENCY', 400],
  DECIMAL_PRECISION: ['INVALID_AMOUNT', 400],
};

function truncate(s, n = 300) {
  const str = String(s || '');
  return str.length > n ? `${str.slice(0, n)}…` : str;
}

/** Turn a non-2xx PayPal response into a PaymentError. */
function fromPayPalResponse(status, body, debugId) {
  const details = Array.isArray(body && body.details) ? body.details : [];
  const issues = details.map((d) => ({ issue: d.issue, description: truncate(d.description, 200) }));
  const message = truncate((body && (body.message || (details[0] && details[0].description))) || `PayPal returned HTTP ${status}`);
  const base = { debugId: debugId || (body && body.debug_id) || null, issues };

  const known = details.find((d) => ISSUE_MAP[d.issue]);
  if (known) {
    const [code, httpStatus] = ISSUE_MAP[known.issue];
    return new PaymentError(code, message, { ...base, httpStatus });
  }

  if (status === 400) return new PaymentError('INVALID_REQUEST', message, { ...base, httpStatus: 400 });
  if (status === 401) return new PaymentError('PAYPAL_AUTH_FAILED', 'PayPal rejected our credentials', { ...base, httpStatus: 502 });
  if (status === 403) return new PaymentError('PAYPAL_FORBIDDEN', message, { ...base, httpStatus: 502 });
  if (status === 404) return new PaymentError('PAYMENT_NOT_FOUND', message, { ...base, httpStatus: 404 });
  if (status === 409) return new PaymentError('PAYPAL_CONFLICT', message, { ...base, httpStatus: 409 });
  if (status === 422) return new PaymentError('PAYPAL_UNPROCESSABLE', message, { ...base, httpStatus: 422 });
  if (status === 429) return new PaymentError('PAYPAL_RATE_LIMITED', message, { ...base, httpStatus: 503, retryable: true });
  if (status >= 500) return new PaymentError('PAYPAL_UNAVAILABLE', message, { ...base, httpStatus: 502, retryable: true });
  return new PaymentError('PAYPAL_ERROR', message, { ...base, httpStatus: 502 });
}

module.exports = { PaymentError, fromPayPalResponse };
