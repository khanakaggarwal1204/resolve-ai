'use strict';

const { loadPayPalConfig } = require('../../config/paypal.config');
const { createPayPalClient } = require('./paypalClient');
const { createPaymentService } = require('./paymentService');
const { IdempotencyStore } = require('./idempotency');
const { PaymentError } = require('./paypalErrors');
const paymentState = require('./paymentState');

/** Wire everything from environment variables. */
function createDefaultPaymentService({ logger } = {}) {
  const config = loadPayPalConfig();
  const client = createPayPalClient({ config, logger });
  const store = new IdempotencyStore({ ttlMs: config.idempotencyTtlMs });
  return createPaymentService({ client, store, config });
}

module.exports = { createDefaultPaymentService, createPaymentService, createPayPalClient, IdempotencyStore, PaymentError, ...paymentState };
