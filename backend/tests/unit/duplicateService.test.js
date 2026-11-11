'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { compareCases, tokenize, jaccard, NOTE } = require('../../src/services/duplicateService');

const base = { id: 'a', payment_reference_id: 'pay_1', buyer_user_id: 'u1', issue_type: 'not_received', status: 'submitted', source_mode: 'app_owned', created_at: '2026-10-01T00:00:00Z',
  narrative: 'My headphones order has not arrived and tracking shows nothing new for over a week.' };

test('same payment reference alone gives a low-confidence hint', () => {
  const h = compareCases(base, { ...base, id: 'b', buyer_user_id: 'u2', issue_type: 'other', narrative: 'zipper broken' });
  assert.deepStrictEqual(h.reasons.map((r) => r.code), ['same_payment_reference']);
  assert.strictEqual(h.confidence, 'low');
});

test('same buyer + same issue type on a different payment is flagged, different buyer is not', () => {
  const same = compareCases(base, { ...base, id: 'b', payment_reference_id: 'pay_2', narrative: 'completely different words about something else entirely' });
  assert.deepStrictEqual(same.reasons.map((r) => r.code), ['same_issue_type']);
  const other = compareCases(base, { ...base, id: 'c', payment_reference_id: 'pay_2', buyer_user_id: 'u2' });
  assert.strictEqual(other, null, 'a different buyer with the same issue type is normal, not a hint');
});

test('similar narrative from the same buyer adds a reason and raises confidence to medium (never higher)', () => {
  const h = compareCases(base, { ...base, id: 'b', payment_reference_id: 'pay_2', narrative: 'My notebook order has not arrived and tracking shows nothing new for over a week.' });
  assert.ok(h.reasons.some((r) => r.code === 'similar_narrative'));
  assert.strictEqual(h.confidence, 'medium');
});

test('short narratives are never compared for similarity', () => {
  const a = { ...base, narrative: 'not arrived' };
  const b = { ...base, id: 'b', payment_reference_id: 'pay_2', narrative: 'not arrived' };
  assert.ok(!compareCases(a, b).reasons.some((r) => r.code === 'similar_narrative'));
});

test('a case is never its own duplicate; nothing in common returns null', () => {
  assert.strictEqual(compareCases(base, base), null);
  assert.strictEqual(compareCases(base, { ...base, id: 'z', payment_reference_id: 'pay_9', buyer_user_id: 'u9', issue_type: 'other' }), null);
});

test('hint wording stays probabilistic and never accuses', () => {
  const h = compareCases(base, { ...base, id: 'b' });
  const text = JSON.stringify(h) + NOTE;
  assert.ok(/possible|probabilistic/i.test(text));
  assert.ok(!/fraud|scam|dishonest|liar/i.test(JSON.stringify(h)));
});

test('tokenize folds case, punctuation, stop words and plurals', () => {
  assert.deepStrictEqual([...tokenize('The ITEMS were late!')].sort(), ['item', 'late']);
  assert.strictEqual(jaccard(new Set(), new Set(['a'])), 0);
});
