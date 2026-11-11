'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { startTestApp, MERCHANT, OTHER_MERCHANT, BUYER } = require('../helpers');

let t;
before(async () => { t = await startTestApp(); });
after(async () => { await t.close(); });

const patch = (id, body, opts = {}) => t.call('PATCH', `/api/merchant/cases/${id}`, { user: MERCHANT, body, ...opts });

// ---------- auth, role, ownership ----------
test('no user -> 401; unknown user -> 401; DEMO_MODE off -> 401 (header auth never works outside demos)', async () => {
  assert.strictEqual((await t.call('GET', '/api/merchant/cases')).status, 401);
  assert.strictEqual((await t.call('GET', '/api/merchant/cases', { user: 'user_nobody' })).status, 401);
  const off = await startTestApp({ demoMode: false });
  const r = await off.call('GET', '/api/merchant/cases', { user: MERCHANT });
  assert.strictEqual(r.status, 401);
  assert.strictEqual(r.error.code, 'AUTH_NOT_CONFIGURED');
  await off.close();
});

test('wrong role: a buyer cannot list, read or change merchant cases (403)', async () => {
  assert.strictEqual((await t.call('GET', '/api/merchant/cases', { user: BUYER })).status, 403);
  assert.strictEqual((await t.call('GET', '/api/merchant/cases/case_demo_001', { user: BUYER })).status, 403);
  const r = await t.call('PATCH', '/api/merchant/cases/case_demo_001', { user: BUYER, body: { status: 'closed' } });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(t.db.prepare("SELECT status FROM resolution_cases WHERE id='case_demo_001'").get().status, 'submitted', 'unauthorized action must not change data');
});

test('wrong ownership: another merchant gets 404 (not 403) on read and write, and sees none of it in the list', async () => {
  const get = await t.call('GET', '/api/merchant/cases/case_demo_001', { user: OTHER_MERCHANT });
  assert.strictEqual(get.status, 404);
  const write = await t.call('PATCH', '/api/merchant/cases/case_demo_001', { user: OTHER_MERCHANT, body: { status: 'closed' } });
  assert.strictEqual(write.status, 404);
  assert.strictEqual(t.db.prepare("SELECT status FROM resolution_cases WHERE id='case_demo_001'").get().status, 'submitted');
  const list = await t.call('GET', '/api/merchant/cases', { user: OTHER_MERCHANT });
  assert.deepStrictEqual(list.data.items.map((i) => i.id), ['case_demo_006']);
  const mine = await t.call('GET', '/api/merchant/cases', { user: MERCHANT });
  assert.ok(!mine.data.items.some((i) => i.id === 'case_demo_006'));
});

test('buyer drafts are invisible to merchants; malformed ids are rejected', async () => {
  t.models.cases.insert({ id: 'case_hidden_draft', payment_reference_id: 'pay_demo_004', buyer_user_id: BUYER, merchant_user_id: MERCHANT, issue_type: 'other', status: 'draft' });
  assert.strictEqual((await t.call('GET', '/api/merchant/cases/case_hidden_draft', { user: MERCHANT })).status, 404);
  assert.ok(!(await t.call('GET', '/api/merchant/cases', { user: MERCHANT })).data.items.some((i) => i.id === 'case_hidden_draft'));
  assert.strictEqual((await t.call('GET', '/api/merchant/cases/bad%20id!', { user: MERCHANT })).status, 400);
});

// ---------- inbox ----------
test('inbox lists status, issue type, priority, payment reference and duplicate hint', async () => {
  const { data } = await t.call('GET', '/api/merchant/cases', { user: MERCHANT });
  const c1 = data.items.find((i) => i.id === 'case_demo_001');
  assert.strictEqual(c1.issue_type, 'not_received');
  assert.strictEqual(c1.status, 'submitted');
  assert.strictEqual(c1.payment.paypal_order_id, 'DEMO-ORD-0001');
  assert.strictEqual(c1.priority, 'high', 'submitted for more than 72h and unreviewed');
  assert.ok(c1.possible_duplicate && c1.possible_duplicate.count >= 1);
  assert.strictEqual(data.items.find((i) => i.id === 'case_demo_005').priority, 'low');
  assert.ok(data.items.every((i) => i.source_mode === 'synthetic_demo' && i.payment.source_mode === 'synthetic_demo'), 'seeded rows must be labelled synthetic');
  // high priority sorts first, low last
  assert.strictEqual(data.items[0].priority, 'high');
  assert.strictEqual(data.items[data.items.length - 1].priority, 'low');
});

test('inbox filters: status, priority, issue_type, search; bad filter values are 400', async () => {
  const q = (s) => t.call('GET', `/api/merchant/cases?${s}`, { user: MERCHANT });
  assert.deepStrictEqual((await q('status=awaiting_information')).data.items.map((i) => i.id), ['case_demo_004']);
  assert.ok((await q('status=submitted,under_review')).data.items.every((i) => ['submitted', 'under_review'].includes(i.status)));
  assert.ok((await q('priority=low')).data.items.every((i) => i.priority === 'low'));
  assert.ok((await q('issue_type=not_received')).data.items.every((i) => i.issue_type === 'not_received'));
  assert.deepStrictEqual((await q('q=DEMO-ORD-0003')).data.items.map((i) => i.id), ['case_demo_003']);
  for (const bad of ['status=nope', 'status=draft', 'priority=urgent', 'issue_type=x', 'limit=0', 'limit=1000']) assert.strictEqual((await q(bad)).status, 400, bad);
});

// ---------- duplicate hints ----------
test('duplicate hint is explicitly probabilistic, lists reasons, and never crosses merchants', async () => {
  const { data } = await t.call('GET', '/api/merchant/cases/case_demo_001', { user: MERCHANT });
  const hints = data.duplicate_hints;
  assert.ok(/probabilistic/i.test(hints.note));
  const other = hints.items.find((h) => h.case_id === 'case_demo_002');
  assert.deepStrictEqual(other.reasons.map((r) => r.code), ['same_payment_reference']);
  const similar = hints.items.find((h) => h.case_id === 'case_demo_004');
  assert.ok(similar.reasons.some((r) => r.code === 'similar_narrative') && similar.reasons.some((r) => r.code === 'same_issue_type'));
  assert.strictEqual(similar.confidence, 'medium');
  assert.ok(!hints.items.some((h) => h.case_id === 'case_demo_006'), "must not reference another merchant's case");
  assert.ok(!/fraud|scam|dishonest/i.test(JSON.stringify(hints.items)), 'hint items never accuse');
});

// ---------- review payload: timeline, evidence, gaps, labels ----------
test('review payload has timeline, buyer narrative labelled as unverified/synthetic, evidence list and AI brief', async () => {
  const { data } = await t.call('GET', '/api/merchant/cases/case_demo_001', { user: MERCHANT });
  assert.strictEqual(data.case.narrative_source_mode, 'synthetic_demo');
  assert.strictEqual(data.payment.source_mode, 'synthetic_demo');
  assert.ok(data.timeline.length >= 3 && data.timeline.every((e) => e.source_mode && e.timestamp));
  assert.deepStrictEqual(data.timeline.map((e) => e.timestamp), [...data.timeline.map((e) => e.timestamp)].sort((a, b) => Date.parse(a) - Date.parse(b)));
  assert.strictEqual(data.evidence.length, 1);
  assert.strictEqual(data.evidence[0].verified_at, null);
  assert.strictEqual(data.recommendation.model_version, 'seed-v1');
  assert.ok(data.recommendation.verified_facts.every((f) => f.source_field), 'brief facts carry a source field');
  assert.ok(data.case.allowed_transitions.includes('under_review'));
});

test('missing evidence is called out even with no AI brief (deterministic gaps)', async () => {
  const { data } = await t.call('GET', '/api/merchant/cases/case_demo_003', { user: MERCHANT });
  assert.strictEqual(data.evidence.length, 0);
  assert.strictEqual(data.recommendation, null);
  assert.deepStrictEqual(data.evidence_gaps.map((g) => g.type), ['order_confirmation', 'screenshot']);
  const withEv = (await t.call('GET', '/api/merchant/cases/case_demo_001', { user: MERCHANT })).data;
  assert.ok(!withEv.evidence_gaps.some((g) => g.type === 'order_confirmation'), 'a supplied item is no longer a gap');
  assert.ok(withEv.evidence_gaps.some((g) => g.type === 'tracking_info'));
});

test('real sandbox payments are labelled verified only via the server-side upsert; missing/incomplete payment is rejected', () => {
  assert.throws(() => t.models.payments.upsertVerified({ orderId: 'ORDX' }), /normalized PayPal payment/);
  assert.throws(() => t.models.payments.upsertVerified(null));
  const p = t.models.payments.upsertVerified({ orderId: 'SBX123ABC', captureId: 'CAP1', amount: { value: 40, currency: 'usd' }, providerStatus: { order: 'COMPLETED', capture: 'COMPLETED' }, merchantLabel: 'Demo Store' });
  assert.strictEqual(p.source_mode, 'paypal_sandbox_verified');
  assert.strictEqual(p.amount, '40.00');
  assert.strictEqual(p.currency, 'USD');
  assert.strictEqual(t.models.payments.upsertVerified({ orderId: 'SBX123ABC', captureId: 'CAP1', amount: { value: 40, currency: 'USD' }, providerStatus: { capture: 'REFUNDED' } }).id, p.id, 'upsert, not duplicate');
  assert.throws(() => t.db.prepare("INSERT INTO resolution_cases (id, payment_reference_id, buyer_user_id, merchant_user_id, issue_type, status, source_mode, created_at, updated_at) VALUES ('c_x','pay_missing','user_buyer_alice','user_merchant_demo','other','submitted','app_owned','t','t')").run(), /FOREIGN KEY/);
});

// ---------- merchant actions ----------
test('PATCH is strict: unknown fields (amount, source_mode, buyer) are rejected; status/draft are validated', async () => {
  for (const body of [{ amount: '1.00' }, { source_mode: 'paypal_sandbox_verified' }, { status: 'closed', buyer_user_id: 'x' }, {}, [], { status: 'refunded' }, { status: 'draft' }, { merchant_draft: 5 }, { merchant_draft: 'x'.repeat(4001) }]) {
    const r = await patch('case_demo_003', body);
    assert.strictEqual(r.status, 400, JSON.stringify(body).slice(0, 60));
  }
  assert.strictEqual((await t.call('PATCH', '/api/merchant/cases/case_demo_003', { user: MERCHANT, body: '{not json' })).status, 400);
});

test('save draft + mark reviewed: updates the case, records an action and audit events, no money moves', async () => {
  const r = await patch('case_demo_001', { merchant_draft: '  Thanks for flagging this. Could you confirm the delivery address?  ' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.case.merchant_draft, 'Thanks for flagging this. Could you confirm the delivery address?');
  assert.strictEqual(r.data.meta.changed, true);
  const r2 = await patch('case_demo_001', { status: 'under_review' });
  assert.strictEqual(r2.data.case.status, 'under_review');
  assert.ok(r2.data.case.reviewed_at);
  assert.strictEqual(r2.data.case.priority, 'normal', 'no longer waiting for first review');
  const events = r2.data.audit.map((a) => a.event_type);
  assert.ok(events.includes('merchant_draft_saved') && events.includes('merchant_reviewed'));
  const draftEvent = r2.data.audit.find((a) => a.event_type === 'merchant_draft_saved');
  assert.deepStrictEqual(Object.keys(draftEvent.metadata), ['draft_length'], 'draft text is not copied into the audit trail');
  assert.strictEqual(draftEvent.actor_id, MERCHANT);
  assert.ok(r2.data.timeline.some((e) => /under review/i.test(e.label)));
  assert.strictEqual(t.db.prepare("SELECT COUNT(*) n FROM case_actions WHERE case_id='case_demo_001'").get().n, 2);
  assert.strictEqual(t.db.prepare("SELECT amount, verified_status FROM payment_references WHERE id='pay_demo_001'").get().amount, '49.99');
});

test('no-op PATCH changes nothing and writes no audit event', async () => {
  const before = (await t.call('GET', '/api/merchant/cases/case_demo_001', { user: MERCHANT })).data.audit.length;
  const r = await patch('case_demo_001', { status: 'under_review' });
  assert.strictEqual(r.data.meta.changed, false);
  assert.strictEqual(r.data.audit.length, before);
});

test('request-more-information needs a message to the buyer', async () => {
  const noMsg = await patch('case_demo_003', { status: 'awaiting_information' });
  assert.strictEqual(noMsg.status, 422);
  assert.strictEqual(noMsg.error.code, 'MESSAGE_REQUIRED');
  const ok = await patch('case_demo_003', { status: 'awaiting_information', merchant_draft: 'Please send a screenshot of the price you saw at checkout.' });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.data.case.status, 'awaiting_information');
  assert.ok(ok.data.audit.some((a) => a.event_type === 'merchant_requested_information'));
});

test('invalid transitions are rejected (409) and closed cases are immutable', async () => {
  const bad = await patch('case_demo_005', { status: 'under_review' }); // resolved -> under_review
  assert.strictEqual(bad.status, 409);
  assert.strictEqual(bad.error.code, 'INVALID_TRANSITION');
  assert.strictEqual((await patch('case_demo_005', { status: 'closed' })).status, 200);
  const frozen = await patch('case_demo_005', { merchant_draft: 'late edit' });
  assert.strictEqual(frozen.status, 409);
  assert.strictEqual(frozen.error.code, 'CASE_CLOSED');
  assert.ok((await t.call('GET', '/api/merchant/cases/case_demo_005', { user: MERCHANT })).data.audit.some((a) => a.event_type === 'case_closed'));
});

test('idempotency: same key replays without a second change; same key with a different body is rejected', async () => {
  const key = 'merchant-key-0001';
  const first = await patch('case_demo_004', { merchant_draft: 'Following up: any update on the tracking number?' }, { headers: { 'Idempotency-Key': key } });
  assert.strictEqual(first.data.meta.idempotentReplay, false);
  const events = first.data.audit.length;
  const replay = await patch('case_demo_004', { merchant_draft: 'Following up: any update on the tracking number?' }, { headers: { 'Idempotency-Key': key } });
  assert.strictEqual(replay.status, 200);
  assert.strictEqual(replay.headers.get('idempotent-replayed'), 'true');
  assert.strictEqual(replay.data.audit.length, events, 'no duplicate audit event');
  const reuse = await patch('case_demo_004', { merchant_draft: 'something else' }, { headers: { 'Idempotency-Key': key } });
  assert.strictEqual(reuse.status, 422);
  assert.strictEqual(reuse.error.code, 'IDEMPOTENCY_KEY_REUSED');
  assert.strictEqual((await patch('case_demo_004', { merchant_draft: 'x' }, { headers: { 'Idempotency-Key': 'short' } })).status, 400);
});

test('every response uses the { data, error, requestId } envelope; errors never leak internals', async () => {
  const ok = await t.call('GET', '/api/health');
  assert.strictEqual(ok.status, 200);
  assert.ok(ok.json.requestId && ok.json.error === null && ok.data.database === 'ok');
  const nf = await t.call('GET', '/api/merchant/cases/case_nope_999', { user: MERCHANT });
  assert.deepStrictEqual(Object.keys(nf.json).sort(), ['data', 'error', 'requestId']);
  assert.ok(!/SELECT|sqlite|at\s+\S+\s+\(/i.test(JSON.stringify(nf.json)));
  assert.strictEqual((await t.call('GET', '/api/nope')).status, 404);
});
