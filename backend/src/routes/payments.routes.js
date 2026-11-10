'use strict';

const { PaymentError } = require('../services/payments/paypalErrors');
const { captureOutcome } = require('../services/payments/paymentState');
const { createDefaultPaymentService } = require('../services/payments');

/**
 * Express wiring for the payments API. Needs `express.json()` before it.
 *
 *   POST /orders                    body { amount, currency?, description?, referenceId?, merchantLabel? }
 *                                   header Idempotency-Key (required)  -> 201 (200 on replay)
 *                                   response { orderId, approvalUrl, payment, transaction, meta }
 *                                   the frontend redirects the buyer to approvalUrl (PayPal sandbox)
 *   POST /orders/:orderId/capture   header Idempotency-Key (optional)
 *                                   captured -> 201 (200 on replay) { orderId, captureId, outcome:'captured', verified:true, payment, transaction, meta }
 *                                   pending / unknown -> 202 (outcome 'pending' | 'unknown'; check again with GET /orders/:id)
 *                                   declined / failed -> 402 { error }, buyer has not approved -> 409 ORDER_NOT_APPROVED
 *   GET  /orders/:orderId           -> 200
 *   GET  /captures/:captureId       -> 200
 */
function createPaymentHandlers(service) {
  const header = (req, name) => (typeof req.get === 'function' ? req.get(name) : req.headers && req.headers[name.toLowerCase()]);

  const send = (res, result, createdStatus) => {
    const replay = result.meta.idempotentReplay;
    if (replay) res.setHeader('Idempotent-Replayed', 'true');
    res.status(createdStatus && !replay ? createdStatus : 200).json(result);
  };

  return {
    async createOrder(req, res, next) {
      try {
        const result = await service.createOrder(req.body || {}, { idempotencyKey: header(req, 'Idempotency-Key') });
        // orderId + approvalUrl are repeated at the top level so the frontend can redirect without digging.
        send(res, { orderId: result.payment.orderId, approvalUrl: result.payment.approvalUrl, ...result }, 201);
      } catch (e) { next(e); }
    },
    async captureOrder(req, res, next) {
      try {
        const result = await service.captureOrder(req.params.orderId, { idempotencyKey: header(req, 'Idempotency-Key') });
        const { payment } = result;
        const outcome = captureOutcome(payment);

        if (outcome === 'failed') {
          const reason = payment.statusReason ? ` (${payment.statusReason})` : '';
          return next(new PaymentError(payment.state === 'declined' ? 'PAYMENT_DECLINED' : 'PAYMENT_FAILED', `PayPal did not capture this payment: ${payment.state}${reason}`, { httpStatus: 402 }));
        }

        const body = { orderId: payment.orderId, captureId: payment.captureId, outcome, verified: outcome === 'captured' && Boolean(payment.captureId), ...result };
        if (outcome === 'pending' || outcome === 'unknown') {
          // Not final: 202 so the client keeps the order and checks again instead of calling it paid or failed.
          if (result.meta.idempotentReplay) res.setHeader('Idempotent-Replayed', 'true');
          return res.status(202).json(body);
        }
        send(res, body, 201);
      } catch (e) { next(e); }
    },
    async getOrder(req, res, next) {
      try { send(res, await service.getOrder(req.params.orderId)); } catch (e) { next(e); }
    },
    async getCapture(req, res, next) {
      try { send(res, await service.getCapture(req.params.captureId)); } catch (e) { next(e); }
    },
  };
}

function paymentErrorHandler(err, req, res, next) {
  if (err instanceof PaymentError) return res.status(err.httpStatus).json(err.toJSON());
  return next(err);
}

/** registerPaymentRoutes(express.Router()) -> router. Pass a service to override the default (tests). */
function registerPaymentRoutes(router, service = createDefaultPaymentService()) {
  const h = createPaymentHandlers(service);
  router.post('/orders', h.createOrder);
  router.post('/orders/:orderId/capture', h.captureOrder);
  router.get('/orders/:orderId', h.getOrder);
  router.get('/captures/:captureId', h.getCapture);
  router.use(paymentErrorHandler);
  return router;
}

module.exports = { registerPaymentRoutes, createPaymentHandlers, paymentErrorHandler };
