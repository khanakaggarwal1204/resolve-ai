'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { openDatabase } = require('../../src/db');
const { createAuditService, AUDIT_EVENTS } = require('../../src/services/auditService');
const { redact } = require('../../src/utils/redact');

const setup = () => { const db = openDatabase(':memory:'); return { db, audit: createAuditService({ db }) }; };

test('records actor, action, target and timestamp', () => {
  const { audit } = setup();
  audit.record({ actorId: 'u1', eventType: AUDIT_EVENTS.CASE_CREATED, targetId: 'case_1', metadata: { issue_type: 'other' } });
  const [e] = audit.listForTarget('case_1');
  assert.strictEqual(e.actor_id, 'u1');
  assert.strictEqual(e.event_type, 'case_created');
  assert.deepStrictEqual(e.metadata, { issue_type: 'other' });
  assert.ok(!Number.isNaN(Date.parse(e.timestamp)));
});

test('credentials, emails and card-like numbers never reach the trail', () => {
  const { db, audit } = setup();
  audit.record({ actorId: 'u1', eventType: 'x', targetId: 't', metadata: {
    PAYPAL_CLIENT_SECRET: 'sh-secret', authorization: 'Bearer abc', api_key: 'k', nested: { password: 'p' },
    note: 'mail jane.doe@example.com card 4111 1111 1111 1111', long: 'x'.repeat(1000),
  } });
  const raw = db.prepare('SELECT metadata_redacted FROM audit_events').get().metadata_redacted;
  for (const leak of ['sh-secret', 'Bearer abc', 'jane.doe', '4111', '"k"', '"p"']) assert.ok(!raw.includes(leak), `leaked ${leak}`);
  assert.ok(raw.includes('[redacted]') && raw.includes('[email]') && raw.includes('[number]') && raw.includes('truncated'));
});

test('the trail is append-only: UPDATE and DELETE are rejected by the database', () => {
  const { db, audit } = setup();
  audit.record({ actorId: 'u1', eventType: 'x', targetId: 't' });
  assert.throws(() => db.prepare("UPDATE audit_events SET actor_id = 'evil'").run(), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM audit_events').run(), /append-only/);
});

test('requires actor, event and target', () => {
  const { audit } = setup();
  assert.throws(() => audit.record({ eventType: 'x', targetId: 't' }), /needs actorId/);
});

test('redact does not mutate its input and bounds depth', () => {
  const input = { a: { b: { c: { d: { e: 'deep' } } } }, token: 't' };
  const out = redact(input);
  assert.strictEqual(input.token, 't');
  assert.strictEqual(out.token, '[redacted]');
  assert.strictEqual(out.a.b.c.d, '[nested]');
});
