'use strict';

/**
 * Payment-state normalization.
 *
 * PayPal has two separate status vocabularies (order status vs capture status).
 * The rest of the app should never have to care, so everything is collapsed into
 * ONE internal state. When a capture exists, the capture status wins (an order can
 * be COMPLETED while its capture is still PENDING).
 */
const STATES = Object.freeze({
  CREATED: 'created',
  REQUIRES_APPROVAL: 'requires_approval',
  APPROVED: 'approved',
  PENDING: 'pending',
  COMPLETED: 'completed',
  DECLINED: 'declined',
  FAILED: 'failed',
  REFUNDED: 'refunded',
  PARTIALLY_REFUNDED: 'partially_refunded',
  VOIDED: 'voided',
  UNKNOWN: 'unknown',
});

const ORDER_STATUS_TO_STATE = {
  CREATED: STATES.CREATED,
  SAVED: STATES.CREATED,
  PAYER_ACTION_REQUIRED: STATES.REQUIRES_APPROVAL,
  APPROVED: STATES.APPROVED,
  VOIDED: STATES.VOIDED,
  COMPLETED: STATES.COMPLETED,
};

const CAPTURE_STATUS_TO_STATE = {
  COMPLETED: STATES.COMPLETED,
  PENDING: STATES.PENDING,
  DECLINED: STATES.DECLINED,
  FAILED: STATES.FAILED,
  REFUNDED: STATES.REFUNDED,
  PARTIALLY_REFUNDED: STATES.PARTIALLY_REFUNDED,
};

const TERMINAL = new Set([STATES.COMPLETED, STATES.DECLINED, STATES.FAILED, STATES.REFUNDED, STATES.PARTIALLY_REFUNDED, STATES.VOIDED]);

const orderState = (s) => ORDER_STATUS_TO_STATE[String(s || '').toUpperCase()] || STATES.UNKNOWN;
const captureState = (s) => CAPTURE_STATUS_TO_STATE[String(s || '').toUpperCase()] || STATES.UNKNOWN;
const isTerminal = (state) => TERMINAL.has(state);

function toAmount(a) {
  if (!a) return { value: null, currency: null };
  const value = Number(a.value);
  return { value: Number.isFinite(value) ? value : null, currency: a.currency_code || null };
}

function findApprovalUrl(links) {
  const l = (links || []).find((x) => x.rel === 'approve' || x.rel === 'payer-action');
  return l ? l.href : null;
}

/** Normalize a PayPal Orders v2 order (create / get / capture all return this shape). */
function normalizeOrder(order, { environment = 'sandbox' } = {}) {
  const unit = (order.purchase_units || [])[0] || {};
  const captures = (unit.payments && unit.payments.captures) || [];
  const capture = captures.length ? captures[captures.length - 1] : null;

  return {
    provider: 'paypal',
    environment,
    orderId: order.id || null,
    captureId: capture ? capture.id : null,
    state: capture ? captureState(capture.status) : orderState(order.status),
    providerStatus: { order: order.status || null, capture: capture ? capture.status : null },
    amount: toAmount(capture ? capture.amount : unit.amount),
    createdAt: (capture && capture.create_time) || order.create_time || null,
    updatedAt: (capture && capture.update_time) || order.update_time || null,
    approvalUrl: findApprovalUrl(order.links),
    statusReason: (capture && capture.status_details && capture.status_details.reason) || null,
    // We store the merchant label in purchase_units[0].custom_id when creating the order.
    merchantLabel: (unit.payee && unit.payee.display_name) || unit.custom_id || null,
  };
}

/** Normalize a PayPal Payments v2 capture (GET /v2/payments/captures/{id}). */
function normalizeCapture(capture, { environment = 'sandbox' } = {}) {
  return {
    provider: 'paypal',
    environment,
    orderId: (capture.supplementary_data && capture.supplementary_data.related_ids && capture.supplementary_data.related_ids.order_id) || null,
    captureId: capture.id || null,
    state: captureState(capture.status),
    providerStatus: { order: null, capture: capture.status || null },
    amount: toAmount(capture.amount),
    createdAt: capture.create_time || null,
    updatedAt: capture.update_time || null,
    approvalUrl: null,
    statusReason: (capture.status_details && capture.status_details.reason) || null,
    merchantLabel: capture.custom_id || null,
  };
}

/**
 * Shape expected by the AI case analyzer's `transaction` field
 * (see services/ai/tests/caseAnalyzer.test.js -> baseCase.transaction).
 * `verified: true` is only honest because this data was fetched from PayPal itself.
 */
function toCaseTransaction(payment) {
  return {
    source: `paypal_${payment.environment}`,
    verified: true,
    orderId: payment.orderId,
    captureId: payment.captureId,
    status: payment.providerStatus.capture || payment.providerStatus.order,
    amount: payment.amount.value,
    currency: payment.amount.currency,
    createdAt: payment.createdAt,
    merchantLabel: payment.merchantLabel,
  };
}

/**
 * What the app should tell the buyer after a capture attempt (derived from the normalized state):
 *   captured  PayPal confirms the money was captured (capture status COMPLETED)
 *   pending   PayPal accepted it but it is not final yet (e.g. under review): check again later
 *   failed    declined / failed / voided: nothing was captured
 *   refunded  was captured, has since been (partly) refunded
 *   unknown   anything else (e.g. order still not approved): do not assume success
 */
function captureOutcome(payment) {
  switch (payment && payment.state) {
    case STATES.COMPLETED: return 'captured';
    case STATES.PENDING: return 'pending';
    case STATES.DECLINED:
    case STATES.FAILED:
    case STATES.VOIDED: return 'failed';
    case STATES.REFUNDED:
    case STATES.PARTIALLY_REFUNDED: return 'refunded';
    default: return 'unknown';
  }
}

module.exports = { captureOutcome, STATES, orderState, captureState, isTerminal, normalizeOrder, normalizeCapture, toCaseTransaction };
