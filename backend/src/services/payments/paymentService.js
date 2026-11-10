'use strict';

const crypto = require('crypto');
const { PaymentError } = require('./paypalErrors');
const { deriveRequestId } = require('./idempotency');
const { normalizeOrder, normalizeCapture, toCaseTransaction, isTerminal } = require('./paymentState');

const ID_RE = /^[A-Za-z0-9_-]{5,64}$/;
const KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;
const AMOUNT_RE = /^\d{1,9}(\.\d{1,2})?$/;
const ZERO_DECIMAL = new Set(['JPY', 'HUF', 'TWD']); // PayPal does not accept decimals for these

const validation = (issues) => new PaymentError('VALIDATION_ERROR', 'Invalid payment request', { httpStatus: 400, issues });

function assertId(value, field) {
  if (typeof value !== 'string' || !ID_RE.test(value)) throw validation([{ field, issue: 'invalid id format' }]);
  return value;
}

function requireKey(key) {
  if (!key) throw new PaymentError('IDEMPOTENCY_KEY_REQUIRED', 'Send an Idempotency-Key header (8-128 chars) when creating a payment.', { httpStatus: 400 });
  return checkKey(key);
}

function checkKey(key) {
  if (typeof key !== 'string' || !KEY_RE.test(key)) {
    throw new PaymentError('IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key must be 8-128 chars of letters, digits, . _ : -', { httpStatus: 400 });
  }
  return key;
}

function validateCreateInput(input, config) {
  const issues = [];
  const src = input && typeof input === 'object' ? input : {};
  const currency = String(src.currency || config.defaultCurrency).toUpperCase();
  const amountStr = typeof src.amount === 'number' ? String(src.amount) : src.amount;

  if (typeof amountStr !== 'string' || !AMOUNT_RE.test(amountStr)) issues.push({ field: 'amount', issue: 'must be a positive number with at most 2 decimals' });
  else if (Number(amountStr) <= 0) issues.push({ field: 'amount', issue: 'must be greater than 0' });
  else if (Number(amountStr) > config.maxAmount) issues.push({ field: 'amount', issue: `must not exceed ${config.maxAmount}` });
  else if (ZERO_DECIMAL.has(currency) && amountStr.includes('.')) issues.push({ field: 'amount', issue: `${currency} does not support decimals` });

  if (!/^[A-Z]{3}$/.test(currency)) issues.push({ field: 'currency', issue: 'must be a 3-letter ISO code' });

  const optional = (field, max) => {
    const v = src[field];
    if (v === undefined || v === null || v === '') return undefined;
    if (typeof v !== 'string' || v.length > max) { issues.push({ field, issue: `must be a string up to ${max} chars` }); return undefined; }
    return v;
  };
  const description = optional('description', 127);
  const referenceId = optional('referenceId', 256) || 'default';
  const merchantLabel = optional('merchantLabel', 255);

  if (issues.length) throw validation(issues);
  const value = ZERO_DECIMAL.has(currency) ? Number(amountStr).toFixed(0) : Number(amountStr).toFixed(2);
  return { value, currency, description, referenceId, merchantLabel };
}

/**
 * Payment service: create / capture / retrieve, built on the PayPal client.
 * Every method resolves to { payment, transaction, meta }:
 *   payment      normalized internal view (see paymentState.js)
 *   transaction  same data in the shape the AI case analyzer expects
 *   meta         { idempotentReplay, reconciled }
 */
function createPaymentService({ client, store, config }) {
  const env = config.environment || 'sandbox';
  const build = (payment, meta = {}) => ({ payment, transaction: toCaseTransaction(payment), meta: { idempotentReplay: false, reconciled: false, ...meta } });
  const mark = ({ value, replayed }) => (replayed ? { ...value, meta: { ...value.meta, idempotentReplay: true } } : value);

  async function fetchOrder(orderId) {
    const res = await client.request({ method: 'GET', path: `/v2/checkout/orders/${orderId}` });
    return normalizeOrder(res.body, { environment: env });
  }

  async function createOrder(input, { idempotencyKey } = {}) {
    const key = requireKey(idempotencyKey);
    const p = validateCreateInput(input, config);

    const unit = { reference_id: p.referenceId, amount: { currency_code: p.currency, value: p.value } };
    if (p.description) unit.description = p.description;
    if (p.merchantLabel) unit.custom_id = p.merchantLabel; // read back as merchantLabel by normalizeOrder
    const body = { intent: 'CAPTURE', purchase_units: [unit] };
    if (config.returnUrl && config.cancelUrl) {
      body.payment_source = { paypal: { experience_context: { return_url: config.returnUrl, cancel_url: config.cancelUrl, user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING' } } };
    }

    const requestId = deriveRequestId('create', key);
    const result = await store.run(`create:${key}`, body, async () => {
      const res = await client.request({ method: 'POST', path: '/v2/checkout/orders', body, requestId });
      const payment = normalizeOrder(res.body, { environment: env });
      // The buyer cannot pay without this link. Throwing here (inside store.run) means the
      // failure is not cached, so retrying with the same Idempotency-Key asks PayPal again.
      if (!payment.orderId || !payment.approvalUrl) {
        throw new PaymentError('PAYPAL_BAD_RESPONSE', 'PayPal created the order but returned no approval link', { httpStatus: 502, debugId: res.debugId });
      }
      return build(payment);
    });
    return mark(result);
  }

  async function doCapture(orderId, requestId) {
    try {
      const res = await client.request({ method: 'POST', path: `/v2/checkout/orders/${orderId}/capture`, body: {}, requestId });
      return build(normalizeOrder(res.body, { environment: env }));
    } catch (err) {
      if (!(err instanceof PaymentError)) throw err;

      // Someone (or an earlier attempt of ours) already captured it: report the real state instead of failing.
      if (err.code === 'ORDER_ALREADY_CAPTURED') return build(await fetchOrder(orderId), { reconciled: true });

      // We never got a definitive answer. Ask PayPal what actually happened before giving up.
      if (err.outcomeUnknown) {
        let order = null;
        try { order = await fetchOrder(orderId); } catch { /* reconciliation failed; fall through */ }
        if (order && order.captureId) return build(order, { reconciled: true });
        if (order) {
          err.outcomeUnknown = false; // confirmed: no capture exists, so it is safe to try again
          err.message = `${err.message} (checked with PayPal: the order has not been captured)`;
        }
      }
      throw err;
    }
  }

  async function captureOrder(orderId, { idempotencyKey } = {}) {
    assertId(orderId, 'orderId');
    const key = idempotencyKey ? checkKey(idempotencyKey) : null;
    // With a client key: derived PayPal-Request-Id (stable across restarts).
    // Without: a fresh id per call, plus in-process dedupe per order and ORDER_ALREADY_CAPTURED recovery.
    // (A fresh id avoids PayPal replaying an old "order not approved" error after the buyer approves.)
    const storeKey = key ? `capture:key:${key}` : `capture:order:${orderId}`;
    const requestId = key ? deriveRequestId('capture', `${key}:${orderId}`) : crypto.randomUUID();
    const result = await store.run(storeKey, { orderId }, () => doCapture(orderId, requestId));
    const marked = mark(result);
    // A duplicate request must never capture twice, but it also must not keep serving an old
    // "pending" answer for 24 h: ask PayPal for the real state (no second capture is sent).
    if (marked.meta.idempotentReplay && !isTerminal(marked.payment.state)) {
      return build(await fetchOrder(orderId), { idempotentReplay: true, reconciled: true });
    }
    return marked;
  }

  async function getOrder(orderId) {
    assertId(orderId, 'orderId');
    return build(await fetchOrder(orderId));
  }

  async function getCapture(captureId) {
    assertId(captureId, 'captureId');
    const res = await client.request({ method: 'GET', path: `/v2/payments/captures/${captureId}` });
    return build(normalizeCapture(res.body, { environment: env }));
  }

  return { createOrder, captureOrder, getOrder, getCapture };
}

module.exports = { createPaymentService, validateCreateInput };
