'use strict';
/**
 * Payment integration tests. No network, no dependencies: PayPal is replaced by a scripted fetch.
 * Run:  node src/services/payments/tests/payments.test.js
 */
const assert = require('assert');
const { createPayPalClient } = require('../paypalClient');
const { createPaymentService } = require('../paymentService');
const { IdempotencyStore } = require('../idempotency');
const { PaymentError } = require('../paypalErrors');
const { normalizeOrder, normalizeCapture, toCaseTransaction } = require('../paymentState');
const { createPaymentHandlers, paymentErrorHandler, registerPaymentRoutes } = require('../../../routes/payments.routes');

// ---------- fixtures & harness ----------
const BASE = { environment: 'sandbox', clientId: 'cid', clientSecret: 'SECRET_VALUE', baseUrl: 'https://api-m.sandbox.paypal.com', timeoutMs: 30, maxRetries: 2, retryBaseDelayMs: 1, tokenSkewMs: 60000, defaultCurrency: 'USD', maxAmount: 10000, returnUrl: '', cancelUrl: '', idempotencyTtlMs: 86400000 };
const KEY = 'order-key-0001';

const reply = (status, body, headers = {}) => ({
  status, ok: status >= 200 && status < 300,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  headers: { get: (k) => headers[k.toLowerCase()] || null },
});
const HANG = { hang: true };
const hang = (init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
const ppError = (status, issue, description, debug = 'dbg-1') => reply(status, { name: 'UNPROCESSABLE_ENTITY', message: description, debug_id: debug, details: issue ? [{ issue, description }] : [] }, { 'paypal-debug-id': debug });

const AMOUNT = { currency_code: 'USD', value: '40.00' };
const orderCreated = (id = 'ORD123ABC') => ({ id, status: 'CREATED', create_time: '2026-10-25T10:00:00Z', purchase_units: [{ reference_id: 'default', amount: AMOUNT, custom_id: 'Demo Store' }], links: [{ rel: 'approve', href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}` }] });
const orderCaptured = (captureStatus = 'COMPLETED', id = 'ORD123ABC', extra = {}) => ({ id, status: 'COMPLETED', create_time: '2026-10-25T10:00:00Z', purchase_units: [{ amount: AMOUNT, custom_id: 'Demo Store', payments: { captures: [{ id: 'CAP456', status: captureStatus, amount: AMOUNT, create_time: '2026-10-25T10:01:00Z', update_time: '2026-10-25T10:01:05Z', ...extra }] } }] });
const orderApproved = (id = 'ORD123ABC') => ({ ...orderCreated(id), status: 'APPROVED' });

function harness({ route, cfg = {}, tokenStatus = 200 }) {
  const calls = []; const tokenCalls = []; let clock = 1_000_000;
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    if (u.pathname === '/v1/oauth2/token') {
      tokenCalls.push({ headers: init.headers, body: init.body });
      if (tokenStatus !== 200) return reply(tokenStatus, { name: 'ERR', message: 'token endpoint down' });
      return reply(200, { access_token: `tok${tokenCalls.length}`, expires_in: 3600, token_type: 'Bearer' });
    }
    const call = { method: init.method, path: u.pathname, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const n = calls.filter((c) => c.method === call.method && c.path === call.path).length;
    const out = await route(call, n);
    return out === HANG ? hang(init) : out;
  };
  const config = { ...BASE, ...cfg };
  const client = createPayPalClient({ config, fetchImpl, sleep: async () => {}, now: () => clock, random: () => 1 });
  const mk = () => createPaymentService({ client, store: new IdempotencyStore({ ttlMs: config.idempotencyTtlMs, now: () => clock }), config });
  return { service: mk(), restart: mk, client, calls, tokenCalls, advance: (ms) => { clock += ms; } };
}

async function rejects(fn, code, check) {
  try { await fn(); } catch (e) {
    assert.ok(e instanceof PaymentError, `expected PaymentError, got ${e && e.stack}`);
    assert.strictEqual(e.code, code, `expected ${code}, got ${e.code}: ${e.message}`);
    if (check) check(e);
    return e;
  }
  assert.fail(`expected rejection with ${code}`);
}
const posts = (h, path = '/v2/checkout/orders') => h.calls.filter((c) => c.method === 'POST' && c.path === path);
const createRoute = (call, n) => reply(201, orderCreated());
let step = 0; const ok = (msg) => console.log(`${++step} ok ${msg}`);

(async () => {
  // 1. OAuth: Basic auth, cached, refreshed after expiry, single-flight
  let h = harness({ route: createRoute });
  await h.service.createOrder({ amount: 40, merchantLabel: 'Demo Store' }, { idempotencyKey: 'key-aaaaaaaa' });
  await h.service.createOrder({ amount: 40 }, { idempotencyKey: 'key-bbbbbbbb' });
  assert.strictEqual(h.tokenCalls.length, 1);
  assert.strictEqual(h.tokenCalls[0].headers.Authorization, `Basic ${Buffer.from('cid:SECRET_VALUE').toString('base64')}`);
  assert.strictEqual(h.tokenCalls[0].body, 'grant_type=client_credentials');
  h.advance(3600 * 1000);
  await h.service.createOrder({ amount: 40 }, { idempotencyKey: 'key-cccccccc' });
  assert.strictEqual(h.tokenCalls.length, 2); assert.strictEqual(h.calls[2].headers.Authorization, 'Bearer tok2');
  h = harness({ route: () => reply(200, orderCreated()) });
  await Promise.all([1, 2, 3].map(() => h.service.getOrder('ORD123ABC')));
  assert.strictEqual(h.tokenCalls.length, 1);
  ok('oauth token: basic auth, cached, refreshed on expiry, single-flight');

  // 2. 401 on an API call -> new token, one retry; persistent 401 -> auth error, no loop
  h = harness({ route: (c, n) => (n === 1 ? reply(401, { name: 'AUTHENTICATION_FAILURE' }) : reply(200, orderCreated())) });
  assert.strictEqual((await h.service.getOrder('ORD123ABC')).payment.state, 'created');
  assert.strictEqual(h.tokenCalls.length, 2);
  h = harness({ route: () => reply(401, { name: 'AUTHENTICATION_FAILURE' }) });
  const authErr = await rejects(() => h.service.getOrder('ORD123ABC'), 'PAYPAL_AUTH_FAILED', (e) => assert.strictEqual(e.httpStatus, 502));
  assert.strictEqual(h.calls.length, 2);
  ok('401 refreshes token once, then fails cleanly');

  // 3. create order: request shape + normalized result
  h = harness({ route: createRoute });
  let r = await h.service.createOrder({ amount: '40.5', currency: 'usd', description: 'Test item', merchantLabel: 'Demo Store' }, { idempotencyKey: KEY });
  const c = h.calls[0];
  assert.strictEqual(c.path, '/v2/checkout/orders'); assert.strictEqual(c.body.intent, 'CAPTURE');
  assert.deepStrictEqual(c.body.purchase_units[0].amount, { currency_code: 'USD', value: '40.50' });
  assert.strictEqual(c.body.purchase_units[0].custom_id, 'Demo Store');
  assert.strictEqual(c.headers.Authorization, 'Bearer tok1'); assert.ok(c.headers['PayPal-Request-Id'].length <= 108);
  assert.strictEqual(r.payment.state, 'created'); assert.ok(r.payment.approvalUrl.includes('ORD123ABC'));
  assert.strictEqual(r.transaction.source, 'paypal_sandbox'); assert.strictEqual(r.transaction.amount, 40); assert.strictEqual(r.meta.idempotentReplay, false);
  ok('create order: correct body/headers, normalized result, analyzer-shaped transaction');

  // 4. validation happens before any PayPal call
  h = harness({ route: createRoute });
  const bad = [{ amount: 0 }, { amount: -5 }, { amount: '10.999' }, { amount: 0.1 + 0.2 }, { amount: 'abc' }, { amount: 20000 }, {}, { amount: 5, currency: 'dollars' }, { amount: 5.5, currency: 'JPY' }, { amount: 5, description: 'x'.repeat(200) }];
  for (const input of bad) await rejects(() => h.service.createOrder(input, { idempotencyKey: KEY }), 'VALIDATION_ERROR', (e) => assert.strictEqual(e.httpStatus, 400));
  await rejects(() => h.service.createOrder({ amount: 5 }, {}), 'IDEMPOTENCY_KEY_REQUIRED');
  await rejects(() => h.service.createOrder({ amount: 5 }, { idempotencyKey: 'short' }), 'IDEMPOTENCY_KEY_INVALID');
  assert.strictEqual(h.calls.length, 0);
  ok(`input validation rejects ${bad.length} bad payloads + missing/invalid key with zero PayPal calls`);

  // 5. idempotency
  h = harness({ route: async () => { await new Promise((res) => setTimeout(res, 10)); return reply(201, orderCreated()); } });
  const results = await Promise.all([1, 2, 3].map(() => h.service.createOrder({ amount: 40 }, { idempotencyKey: KEY })));
  assert.strictEqual(posts(h).length, 1); assert.ok(results.every((x) => x.payment.orderId === 'ORD123ABC'));
  r = await h.service.createOrder({ amount: 40 }, { idempotencyKey: KEY });
  assert.strictEqual(r.meta.idempotentReplay, true); assert.strictEqual(posts(h).length, 1);
  await rejects(() => h.service.createOrder({ amount: 41 }, { idempotencyKey: KEY }), 'IDEMPOTENCY_KEY_REUSED', (e) => assert.strictEqual(e.httpStatus, 422));
  await h.service.createOrder({ amount: 40 }, { idempotencyKey: 'another-key-1' });
  assert.strictEqual(posts(h).length, 2); assert.notStrictEqual(posts(h)[0].headers['PayPal-Request-Id'], posts(h)[1].headers['PayPal-Request-Id']);
  await h.restart().createOrder({ amount: 40 }, { idempotencyKey: KEY }); // simulated server restart
  assert.strictEqual(posts(h)[2].headers['PayPal-Request-Id'], posts(h)[0].headers['PayPal-Request-Id']);
  ok('idempotency: replay, in-flight sharing, key reuse rejected, stable PayPal-Request-Id across restarts');

  // 6. capture success
  h = harness({ route: (call) => (call.method === 'POST' ? reply(201, orderCaptured()) : reply(404, {})) });
  r = await h.service.captureOrder('ORD123ABC');
  assert.strictEqual(r.payment.state, 'completed'); assert.strictEqual(r.payment.captureId, 'CAP456');
  assert.deepStrictEqual(r.transaction, { source: 'paypal_sandbox', verified: true, orderId: 'ORD123ABC', captureId: 'CAP456', status: 'COMPLETED', amount: 40, currency: 'USD', createdAt: '2026-10-25T10:01:00Z', merchantLabel: 'Demo Store' });
  assert.strictEqual(h.calls[0].path, '/v2/checkout/orders/ORD123ABC/capture');
  r = await h.service.captureOrder('ORD123ABC'); // double click / duplicate request
  assert.strictEqual(r.meta.idempotentReplay, true); assert.strictEqual(posts(h, '/v2/checkout/orders/ORD123ABC/capture').length, 1);
  ok('capture: completed, analyzer-shaped transaction, duplicate capture not re-sent');

  // 7. state normalization
  const st = (o) => normalizeOrder(o).state;
  assert.strictEqual(st({ status: 'CREATED' }), 'created'); assert.strictEqual(st({ status: 'SAVED' }), 'created');
  assert.strictEqual(st({ status: 'APPROVED' }), 'approved'); assert.strictEqual(st({ status: 'VOIDED' }), 'voided');
  assert.strictEqual(st({ status: 'COMPLETED' }), 'completed'); assert.strictEqual(st({ status: 'WHATEVER' }), 'unknown');
  const payerAction = normalizeOrder({ id: 'X1', status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'payer-action', href: 'https://pp/x' }] });
  assert.strictEqual(payerAction.state, 'requires_approval'); assert.strictEqual(payerAction.approvalUrl, 'https://pp/x');
  for (const [cs, want] of [['COMPLETED', 'completed'], ['PENDING', 'pending'], ['DECLINED', 'declined'], ['FAILED', 'failed'], ['REFUNDED', 'refunded'], ['PARTIALLY_REFUNDED', 'partially_refunded']]) assert.strictEqual(st(orderCaptured(cs)), want, cs);
  const pend = normalizeOrder(orderCaptured('PENDING', 'ORD123ABC', { status_details: { reason: 'PENDING_REVIEW' } }));
  assert.strictEqual(pend.state, 'pending'); assert.strictEqual(pend.providerStatus.order, 'COMPLETED'); assert.strictEqual(pend.statusReason, 'PENDING_REVIEW'); // capture status wins
  assert.doesNotThrow(() => normalizeOrder({})); assert.strictEqual(normalizeOrder({}).amount.value, null);
  const cap = normalizeCapture({ id: 'CAP456', status: 'REFUNDED', amount: AMOUNT, supplementary_data: { related_ids: { order_id: 'ORD123ABC' } } });
  assert.strictEqual(cap.state, 'refunded'); assert.strictEqual(cap.orderId, 'ORD123ABC'); assert.strictEqual(toCaseTransaction(cap).status, 'REFUNDED');
  ok('state normalization: order + capture vocabularies, capture wins, unknowns safe');

  // 8. ORDER_NOT_APPROVED: mapped, not retried, not cached
  h = harness({ route: (call, n) => (n === 1 ? ppError(422, 'ORDER_NOT_APPROVED', 'Payer has not approved payment', 'dbg-na') : reply(201, orderCaptured())) });
  await rejects(() => h.service.captureOrder('ORD123ABC'), 'ORDER_NOT_APPROVED', (e) => { assert.strictEqual(e.httpStatus, 409); assert.strictEqual(e.debugId, 'dbg-na'); assert.strictEqual(e.retryable, false); });
  assert.strictEqual(h.calls.length, 1);
  assert.strictEqual((await h.service.captureOrder('ORD123ABC')).payment.state, 'completed'); // after the buyer approves
  ok('ORDER_NOT_APPROVED: clean error, no retry, next attempt works');

  // 9. ORDER_ALREADY_CAPTURED -> reconcile instead of failing
  h = harness({ route: (call) => (call.method === 'POST' ? ppError(422, 'ORDER_ALREADY_CAPTURED', 'Order already captured') : reply(200, orderCaptured())) });
  r = await h.service.captureOrder('ORD123ABC');
  assert.strictEqual(r.payment.state, 'completed'); assert.strictEqual(r.meta.reconciled, true);
  ok('ORDER_ALREADY_CAPTURED reconciles to the real state');

  // 10. declined instrument
  h = harness({ route: () => ppError(422, 'INSTRUMENT_DECLINED', 'The instrument presented was declined') });
  await rejects(() => h.service.captureOrder('ORD123ABC'), 'PAYMENT_DECLINED', (e) => assert.strictEqual(e.httpStatus, 402));
  ok('INSTRUMENT_DECLINED -> PAYMENT_DECLINED (402)');

  // 11. retries, timeouts, unknown outcomes
  h = harness({ route: (call, n) => (n === 1 ? HANG : reply(200, orderCreated())) });
  assert.strictEqual((await h.service.getOrder('ORD123ABC')).payment.state, 'created'); assert.strictEqual(h.calls.length, 2);
  h = harness({ route: (call, n) => (n < 3 ? reply(503, { message: 'down' }) : reply(201, orderCreated())) });
  await h.service.createOrder({ amount: 40 }, { idempotencyKey: KEY });
  assert.strictEqual(posts(h).length, 3); assert.strictEqual(new Set(posts(h).map((x) => x.headers['PayPal-Request-Id'])).size, 1);
  h = harness({ route: (call, n) => (n === 1 ? reply(429, { message: 'slow down' }) : reply(201, orderCreated())) });
  await h.service.createOrder({ amount: 40 }, { idempotencyKey: KEY }); assert.strictEqual(posts(h).length, 2);
  h = harness({ route: () => reply(400, { name: 'INVALID_REQUEST', message: 'bad', details: [{ issue: 'MISSING_REQUIRED_PARAMETER', description: 'x' }] }) });
  await rejects(() => h.service.createOrder({ amount: 40 }, { idempotencyKey: KEY }), 'INVALID_REQUEST', (e) => assert.strictEqual(e.httpStatus, 400));
  assert.strictEqual(h.calls.length, 1);
  ok('retries: timeout/503/429 retried (same PayPal-Request-Id), 400 never retried');

  // capture timeouts: PayPal actually captured -> reconciled
  h = harness({ route: (call) => (call.method === 'POST' ? HANG : reply(200, orderCaptured())) });
  r = await h.service.captureOrder('ORD123ABC', { idempotencyKey: KEY });
  assert.strictEqual(r.payment.state, 'completed'); assert.strictEqual(r.meta.reconciled, true);
  assert.strictEqual(new Set(posts(h, '/v2/checkout/orders/ORD123ABC/capture').map((x) => x.headers['PayPal-Request-Id'])).size, 1);
  // capture timeouts: confirmed NOT captured -> retryable, outcome known
  h = harness({ route: (call) => (call.method === 'POST' ? HANG : reply(200, orderApproved())) });
  await rejects(() => h.service.captureOrder('ORD123ABC'), 'PAYPAL_TIMEOUT', (e) => { assert.strictEqual(e.retryable, true); assert.strictEqual(e.outcomeUnknown, false); assert.strictEqual(e.httpStatus, 504); });
  assert.strictEqual(posts(h, '/v2/checkout/orders/ORD123ABC/capture').length, 3);
  // capture timeouts and PayPal unreachable for the check too -> outcome genuinely unknown
  h = harness({ route: () => HANG });
  await rejects(() => h.service.captureOrder('ORD123ABC'), 'PAYPAL_TIMEOUT', (e) => assert.strictEqual(e.outcomeUnknown, true));
  ok('capture timeout: reconciled if captured, retryable if not, outcome_unknown only when truly unknown');

  // token endpoint down: nothing was sent, so outcome is NOT unknown
  h = harness({ route: createRoute, tokenStatus: 503 });
  await rejects(() => h.service.createOrder({ amount: 40 }, { idempotencyKey: KEY }), 'PAYPAL_UNAVAILABLE', (e) => { assert.strictEqual(e.outcomeUnknown, false); assert.strictEqual(e.retryable, true); });
  assert.strictEqual(h.calls.length, 0);
  h = harness({ route: createRoute, cfg: { clientId: '' } });
  await rejects(() => h.service.getOrder('ORD123ABC'), 'PAYPAL_NOT_CONFIGURED');
  h = harness({ route: () => reply(200, '<html>oops</html>') });
  await rejects(() => h.service.getOrder('ORD123ABC'), 'PAYPAL_BAD_RESPONSE');
  ok('token outage, missing credentials, non-JSON response handled');

  // 12. retrieve
  h = harness({ route: (call) => (call.path.includes('/captures/') ? reply(200, { id: 'CAP456', status: 'REFUNDED', amount: AMOUNT, supplementary_data: { related_ids: { order_id: 'ORD123ABC' } } }) : ppError(404, 'INVALID_RESOURCE_ID', 'Specified resource ID does not exist.')) });
  await rejects(() => h.service.getOrder('NOPE12345'), 'PAYMENT_NOT_FOUND', (e) => assert.strictEqual(e.httpStatus, 404));
  r = await h.service.getCapture('CAP456'); assert.strictEqual(r.payment.state, 'refunded'); assert.strictEqual(r.payment.orderId, 'ORD123ABC');
  const before = h.calls.length;
  for (const id of ['../etc/passwd', 'a', 'ORD 123', '', null]) await rejects(() => h.service.getOrder(id), 'VALIDATION_ERROR');
  await rejects(() => h.service.captureOrder('x/../y'), 'VALIDATION_ERROR');
  assert.strictEqual(h.calls.length, before);
  ok('retrieve: 404 mapped, captures normalized, malformed ids never reach PayPal');

  // 13. HTTP handlers
  const mkRes = () => ({ statusCode: null, headers: {}, body: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
  h = harness({ route: createRoute });
  const handlers = createPaymentHandlers(h.service);
  let res = mkRes(); let nextErr = null;
  await handlers.createOrder({ headers: { 'idempotency-key': KEY }, body: { amount: 40 } }, res, (e) => { nextErr = e; });
  assert.strictEqual(res.statusCode, 201); assert.strictEqual(res.body.payment.state, 'created');
  res = mkRes();
  await handlers.createOrder({ headers: { 'idempotency-key': KEY }, body: { amount: 40 } }, res, (e) => { nextErr = e; });
  assert.strictEqual(res.statusCode, 200); assert.strictEqual(res.headers['Idempotent-Replayed'], 'true');
  await handlers.createOrder({ headers: {}, body: { amount: 40 } }, mkRes(), (e) => { nextErr = e; });
  assert.ok(nextErr instanceof PaymentError); res = mkRes();
  paymentErrorHandler(nextErr, {}, res, () => assert.fail('should handle PaymentError'));
  assert.strictEqual(res.statusCode, 400); assert.strictEqual(res.body.error.code, 'IDEMPOTENCY_KEY_REQUIRED');
  let passed = null; paymentErrorHandler(new Error('boom'), {}, mkRes(), (e) => { passed = e; }); assert.strictEqual(passed.message, 'boom');
  const routes = []; const router = { post: (p) => routes.push(`POST ${p}`), get: (p) => routes.push(`GET ${p}`), use: () => routes.push('ERR') };
  registerPaymentRoutes(router, h.service);
  assert.deepStrictEqual(routes, ['POST /orders', 'POST /orders/:orderId/capture', 'GET /orders/:orderId', 'GET /captures/:captureId', 'ERR']);
  ok('http handlers: 201/200 + replay header, errors mapped, routes registered');

  // 13b. create order: approval URL returned to the frontend (top level), redirect-flow body, missing link rejected
  h = harness({ route: (call) => reply(201, { ...orderCreated('ORD777XYZ'), status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORD777XYZ' }] }), cfg: { returnUrl: 'http://localhost:5173/return', cancelUrl: 'http://localhost:5173/cancel' } });
  res = mkRes();
  await createPaymentHandlers(h.service).createOrder({ headers: { 'idempotency-key': KEY }, body: { amount: 50, currency: 'USD' } }, res, (e) => assert.fail(String(e)));
  assert.strictEqual(res.statusCode, 201); assert.strictEqual(res.body.orderId, 'ORD777XYZ');
  assert.strictEqual(res.body.approvalUrl, 'https://www.sandbox.paypal.com/checkoutnow?token=ORD777XYZ');
  assert.strictEqual(res.body.payment.state, 'requires_approval');
  assert.deepStrictEqual(h.calls.find((c) => c.path === '/v2/checkout/orders').body.purchase_units[0].amount, { currency_code: 'USD', value: '50.00' });
  assert.strictEqual(h.calls.find((c) => c.path === '/v2/checkout/orders').body.payment_source.paypal.experience_context.return_url, 'http://localhost:5173/return');
  h = harness({ route: () => reply(201, { ...orderCreated(), links: [] }) });
  await rejects(() => h.service.createOrder({ amount: 50 }, { idempotencyKey: KEY }), 'PAYPAL_BAD_RESPONSE', (e) => assert.strictEqual(e.httpStatus, 502));
  await rejects(() => h.service.createOrder({ amount: 50 }, { idempotencyKey: KEY }), 'PAYPAL_BAD_RESPONSE'); // not cached: asks PayPal again
  assert.strictEqual(posts(h).length, 2);
  ok('create order: $50 -> orderId + approvalUrl at top level, redirect body, missing approval link is an error and not cached');

  // 14. secrets never leak into errors
  h = harness({ route: () => reply(401, { name: 'AUTHENTICATION_FAILURE' }) });
  const leak = await rejects(() => h.service.getOrder('ORD123ABC'), 'PAYPAL_AUTH_FAILED');
  const out = JSON.stringify(leak.toJSON()) + leak.message;
  assert.ok(!out.includes('SECRET_VALUE') && !out.includes('tok1') && !out.includes('Basic '));
  ok('no credentials or tokens in error output');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
