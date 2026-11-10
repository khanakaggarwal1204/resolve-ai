'use strict';

/**
 * Verifies your PayPal sandbox credentials against the real sandbox API.
 *   npm run paypal:check
 * 1) fetches an OAuth token, 2) fetches it again (must come from cache, no second HTTP call),
 * 3) creates a 1.00 test order. Nothing is charged: sandbox orders are not approved or captured.
 */
require('../src/config/env');
const { loadPayPalConfig } = require('../src/config/paypal.config');
const { createPayPalClient } = require('../src/services/payments/paypalClient');

(async () => {
  const config = loadPayPalConfig();
  console.log(`Environment: ${config.environment} (${config.baseUrl})`);

  let tokenCalls = 0;
  const countingFetch = (url, init) => {
    if (String(url).endsWith('/v1/oauth2/token')) tokenCalls++;
    return globalThis.fetch(url, init);
  };
  const client = createPayPalClient({ config, fetchImpl: countingFetch });

  const t1 = await client.getAccessToken();
  const t2 = await client.getAccessToken();
  console.log(`OAuth token OK (length ${t1.length}); second call cached: ${t1 === t2 && tokenCalls === 1}`);

  const res = await client.request({
    method: 'POST',
    path: '/v2/checkout/orders',
    requestId: `check-${Date.now()}`,
    body: { intent: 'CAPTURE', purchase_units: [{ amount: { currency_code: config.defaultCurrency, value: '1.00' } }] },
  });
  console.log(`Test order created: ${res.body.id} (${res.body.status})`);
  const approve = (res.body.links || []).find((l) => l.rel === 'payer-action' || l.rel === 'approve');
  if (approve) console.log(`Approve it as a sandbox buyer here: ${approve.href}`);
})().catch((err) => {
  console.error(`FAILED: ${err.code || err.name}: ${err.message}${err.debugId ? ` (paypal-debug-id ${err.debugId})` : ''}`);
  process.exit(1);
});
