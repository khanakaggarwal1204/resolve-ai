'use strict';

/**
 * Duplicate HINTS for the merchant inbox.
 *
 * Deliberately modest: simple normalized matching over APP-OWNED cases only (never PayPal data),
 * limited to the same merchant's cases (a merchant must never learn about another merchant's cases),
 * and worded as "possible" with the reasons shown. It never says a case IS a duplicate or fraudulent.
 *
 * Signals (a hint needs at least one):
 *   same_payment_reference  another case points at the same payment
 *   same_issue_type         the SAME buyer reported the same issue type (a different buyer with the same issue is normal)
 *   similar_narrative       the SAME buyer used very similar wording (token overlap >= 50%, both >= 4 meaningful words)
 */
const NOTE = 'Possible-duplicate hints are probabilistic. They compare simple fields and wording, and are not a judgment that a case is a duplicate or that anyone acted dishonestly.';

const STOP = new Set(('the and for you your was were with that this have has had not but are from they them their there what when where which would could should about into over just been being because after before again also than then too very can did does get got our out its it\'s i\'m me my mine she him her his who why how all any each few more most other some such only own same so will paid order ordered').split(/\s+/));

function tokenize(text) {
  const words = String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/);
  const out = new Set();
  for (const w of words) {
    if (w.length < 3 || STOP.has(w)) continue;
    out.add(w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w); // crude plural fold: "items" ~ "item"
  }
  return out;
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

const MIN_TOKENS = 4;
const NARRATIVE_THRESHOLD = 0.5;

/** Compare two case rows. Returns a hint object or null. Pure function (no DB), so it is easy to unit test. */
function compareCases(a, b) {
  if (!a || !b || a.id === b.id) return null;
  const reasons = [];
  const sameBuyer = a.buyer_user_id === b.buyer_user_id;

  if (a.payment_reference_id === b.payment_reference_id) {
    reasons.push({ code: 'same_payment_reference', label: 'Another case references the same payment' });
  }
  if (sameBuyer && a.issue_type === b.issue_type) {
    reasons.push({ code: 'same_issue_type', label: 'The same buyer reported the same issue type' });
  }
  if (sameBuyer) {
    const ta = tokenize(a.narrative);
    const tb = tokenize(b.narrative);
    const sim = jaccard(ta, tb);
    if (ta.size >= MIN_TOKENS && tb.size >= MIN_TOKENS && sim >= NARRATIVE_THRESHOLD) {
      reasons.push({ code: 'similar_narrative', label: `The descriptions use very similar wording (about ${Math.round(sim * 100)}% overlap)` });
    }
  }
  if (!reasons.length) return null;

  return {
    case_id: b.id,
    status: b.status,
    issue_type: b.issue_type,
    source_mode: b.source_mode,
    created_at: b.created_at,
    reasons,
    // "medium" = two or more independent signals; never higher, because this is only a hint.
    confidence: reasons.length >= 2 ? 'medium' : 'low',
  };
}

const RANK = { medium: 2, low: 1 };

function createDuplicateService({ db }) {
  const candidates = db.prepare(
    `SELECT * FROM resolution_cases
     WHERE merchant_user_id = @merchant AND id <> @id AND status <> 'draft'
       AND (payment_reference_id = @payment OR buyer_user_id = @buyer)`
  );

  function hintsFor(caseRow) {
    const rows = candidates.all({ merchant: caseRow.merchant_user_id, id: caseRow.id, payment: caseRow.payment_reference_id, buyer: caseRow.buyer_user_id });
    const items = rows.map((r) => compareCases(caseRow, r)).filter(Boolean);
    items.sort((x, y) => RANK[y.confidence] - RANK[x.confidence] || y.reasons.length - x.reasons.length || String(y.created_at).localeCompare(String(x.created_at)));
    return { note: NOTE, items };
  }

  /** Compact form for the inbox: null when there is nothing to flag. */
  function summaryFor(caseRow) {
    const { items } = hintsFor(caseRow);
    if (!items.length) return null;
    return { count: items.length, confidence: items[0].confidence, reasons: [...new Set(items.flatMap((i) => i.reasons.map((r) => r.code)))], label: 'Possible duplicate: review the related case' };
  }

  return { hintsFor, summaryFor };
}

module.exports = { createDuplicateService, compareCases, tokenize, jaccard, NOTE };
