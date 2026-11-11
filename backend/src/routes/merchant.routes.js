'use strict';
const express = require('express');
const requireRole = require('../middleware/requireRole');
const validate = require('../middleware/validate');
const { parseIdParam, parseListQuery, parsePatchBody } = require('../validators/merchant.schemas');

/**
 *   GET   /merchant/cases        ?status=&priority=&issue_type=&q=&limit=&offset=
 *   GET   /merchant/cases/:id
 *   PATCH /merchant/cases/:id    body { status?, merchant_draft? }   header Idempotency-Key (optional)
 * Every route requires a signed-in MERCHANT; the service additionally scopes all reads/writes to that merchant's own cases.
 */
function createMerchantRouter({ auth, controller }) {
  const router = express.Router();
  router.use(auth, requireRole('merchant'));
  router.get('/cases', validate({ query: parseListQuery }), controller.list);
  router.get('/cases/:id', validate({ params: parseIdParam }), controller.get);
  router.patch('/cases/:id', validate({ params: parseIdParam, body: parsePatchBody }), controller.update);
  return router;
}

module.exports = { createMerchantRouter };
