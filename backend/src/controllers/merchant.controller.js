'use strict';
const { asyncHandler } = require('../utils/errors');
const { parseIdempotencyKey } = require('../validators/merchant.schemas');

const send = (req, res, data, status = 200) => res.status(status).json({ data, error: null, requestId: req.id });

function createMerchantController({ merchantService }) {
  return {
    list: asyncHandler(async (req, res) => send(req, res, merchantService.listCases(req.user, req.valid.query))),
    get: asyncHandler(async (req, res) => send(req, res, merchantService.getCase(req.user, req.valid.params.id))),
    update: asyncHandler(async (req, res) => {
      const key = parseIdempotencyKey(req.get('Idempotency-Key'));
      const { view, meta } = merchantService.updateCase(req.user, req.valid.params.id, req.valid.body, { idempotencyKey: key });
      if (meta.idempotentReplay) res.setHeader('Idempotent-Replayed', 'true');
      send(req, res, { ...view, meta });
    }),
  };
}

module.exports = { createMerchantController };
