'use strict';

const { PaymentError } = require('../services/payments/paypalErrors');
const { createDefaultPaymentService } = require('../services/payments');

/**
 * Express wiring for the payments API. Needs `express.json()` before it.
 *
 *   POST /orders                    body { amount, currency?, description?, referenceId?, merchantLabel? }
 *                                   header Idempotency-Key (required)  -> 201 (200 on replay)
 *   POST /orders/:orderId/capture   header Idempotency-Key (optional)  -> 201 (200 on replay)
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
      try { send(res, await service.createOrder(req.body || {}, { idempotencyKey: header(req, 'Idempotency-Key') }), 201); } catch (e) { next(e); }
    },
    async captureOrder(req, res, next) {
      try { send(res, await service.captureOrder(req.params.orderId, { idempotencyKey: header(req, 'Idempotency-Key') }), 201); } catch (e) { next(e); }
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
