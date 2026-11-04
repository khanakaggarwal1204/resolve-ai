'use strict';

/**
 * PayPal sandbox configuration. Reads process.env only; nothing here is secret-logged.
 * Kept separate from config/env.js so the payments module has no hard dependency on it.
 */
const SANDBOX_BASE_URL = 'https://api-m.sandbox.paypal.com';

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function loadPayPalConfig(env = process.env) {
  const baseUrl = (env.PAYPAL_BASE_URL || SANDBOX_BASE_URL).replace(/\/+$/, '');

  // Safety net: this project is sandbox-only. Refuse to talk to live PayPal by accident.
  if (!/sandbox/i.test(baseUrl) && env.PAYPAL_ALLOW_LIVE !== 'true') {
    throw new Error(
      `PAYPAL_BASE_URL (${baseUrl}) is not a sandbox URL. Set PAYPAL_ALLOW_LIVE=true only if you really mean it.`
    );
  }

  return {
    environment: /sandbox/i.test(baseUrl) ? 'sandbox' : 'live',
    clientId: env.PAYPAL_CLIENT_ID || '',
    clientSecret: env.PAYPAL_CLIENT_SECRET || '',
    baseUrl,
    timeoutMs: int(env.PAYPAL_TIMEOUT_MS, 10000),
    maxRetries: int(env.PAYPAL_MAX_RETRIES, 2),
    retryBaseDelayMs: int(env.PAYPAL_RETRY_BASE_DELAY_MS, 300),
    tokenSkewMs: 60 * 1000, // refresh the OAuth token 60s before it expires
    defaultCurrency: (env.PAYPAL_DEFAULT_CURRENCY || 'USD').toUpperCase(),
    maxAmount: Number(env.PAYPAL_MAX_AMOUNT) > 0 ? Number(env.PAYPAL_MAX_AMOUNT) : 10000,
    returnUrl: env.PAYPAL_RETURN_URL || '',
    cancelUrl: env.PAYPAL_CANCEL_URL || '',
    idempotencyTtlMs: int(env.IDEMPOTENCY_TTL_MS, 24 * 60 * 60 * 1000),
  };
}

module.exports = { loadPayPalConfig, SANDBOX_BASE_URL };
