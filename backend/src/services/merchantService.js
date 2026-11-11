'use strict';
const crypto = require('crypto');
const { AUDIT_EVENTS } = require('./auditService');
const { notFound, conflict, unprocessable } = require('../utils/errors');

// What a merchant may do to an app-owned case. None of these touch money or PayPal.
const TRANSITIONS = Object.freeze({
  draft: [],
  submitted: ['under_review', 'awaiting_information', 'closed'],
  under_review: ['awaiting_information', 'resolved', 'closed'],
  awaiting_information: ['under_review', 'resolved', 'closed'],
  resolved: ['closed'],
  closed: [],
});

const STATUS_EVENT = Object.freeze({
  under_review: AUDIT_EVENTS.MERCHANT_REVIEWED,
  awaiting_information: AUDIT_EVENTS.MERCHANT_REQUESTED_INFORMATION,
  resolved: AUDIT_EVENTS.CASE_RESOLVED,
  closed: AUDIT_EVENTS.CASE_CLOSED,
});

const STATUS_LABEL = Object.freeze({
  merchant_reviewed: 'Merchant marked the case as under review',
  merchant_requested_information: 'Merchant requested more information',
  merchant_draft_saved: 'Merchant saved a response draft',
  case_resolved: 'Case marked resolved (app record only)',
  case_closed: 'Case closed (app record only)',
});

// Evidence a reviewer would normally expect for each issue type. Deterministic, so gaps show even before any AI run.
const REQUIRED_EVIDENCE = Object.freeze({
  not_received: [['tracking_info', 'Tracking or delivery information'], ['order_confirmation', 'Order confirmation / receipt']],
  duplicate_charge: [['order_confirmation', 'Order confirmation / receipt'], ['screenshot', 'Statement or screenshot showing both charges']],
  incorrect_amount: [['order_confirmation', 'Itemised order confirmation / invoice'], ['screenshot', 'Screenshot of the price shown at checkout']],
  cancelled_order: [['merchant_message', 'Cancellation confirmation or message with the merchant'], ['order_confirmation', 'Order confirmation / receipt']],
  other: [['order_confirmation', 'Order confirmation / receipt']],
});

const HOUR = 3600e3;

const asSynthetic = (caseRow, mode) => (caseRow.source_mode === 'synthetic_demo' && mode !== 'paypal_sandbox_verified' ? 'synthetic_demo' : mode);

function computeEvidenceGaps(issueType, evidence) {
  const have = new Set(evidence.map((e) => e.type));
  return (REQUIRED_EVIDENCE[issueType] || REQUIRED_EVIDENCE.other)
    .filter(([type]) => !have.has(type))
    .map(([type, label]) => ({ type, label, source_mode: 'app_owned' }));
}

/** high = needs attention soon. low = finished. Derived on read, so it always reflects current data. */
function computePriority(caseRow, rec, nowMs) {
  if (['resolved', 'closed'].includes(caseRow.status)) return 'low';
  const urgency = rec?.urgency?.level;
  if (urgency === 'critical' || urgency === 'high') return 'high';
  if (caseRow.status === 'submitted' && nowMs - Date.parse(caseRow.created_at) > 72 * HOUR) return 'high';
  return 'normal';
}

const PRIORITY_RANK = { high: 0, normal: 1, low: 2 };

function evidenceView(caseRow, e) {
  return {
    id: e.id, case_id: e.case_id, type: e.type, description: e.description, source: e.source,
    attached_by: e.attached_by, verified_at: e.verified_at, created_at: e.created_at,
    source_mode: caseRow.source_mode === 'synthetic_demo' ? 'synthetic_demo' : (e.verified_at ? 'app_owned' : 'user_provided_unverified'),
  };
}

function paymentView(p) {
  return { id: p.id, paypal_order_id: p.paypal_order_id, capture_id: p.capture_id, amount: p.amount, currency: p.currency, verified_status: p.verified_status, merchant_label: p.merchant_label, source_mode: p.source_mode, created_at: p.created_at };
}

function buildTimeline(caseRow, payment, evidence, rec, audit) {
  const items = [
    { id: 't_payment', label: `Payment ${String(payment.verified_status).toLowerCase()} (${payment.amount} ${payment.currency})`, timestamp: payment.created_at, source_mode: payment.source_mode },
    { id: 't_case', label: 'Case opened by buyer', timestamp: caseRow.created_at, source_mode: asSynthetic(caseRow, 'app_owned') },
    ...evidence.map((e) => ({ id: `t_${e.id}`, label: `Evidence added: ${e.description}`, timestamp: e.created_at, source_mode: e.source_mode })),
  ];
  if (rec) items.push({ id: 't_ai', label: rec.is_fallback ? 'Basic summary generated (AI fallback)' : 'AI brief generated', timestamp: rec.created_at, source_mode: asSynthetic(caseRow, 'app_owned') });
  for (const a of audit) {
    const label = STATUS_LABEL[a.event_type];
    if (label) items.push({ id: `t_${a.id}`, label, timestamp: a.timestamp, source_mode: asSynthetic(caseRow, 'app_owned') });
  }
  return items.sort((x, y) => Date.parse(x.timestamp) - Date.parse(y.timestamp));
}

function createMerchantService({ models, audit, duplicates, now = () => new Date().toISOString() }) {
  const nowMs = () => Date.parse(now());
  const buyerName = (id) => models.users.findById(id)?.display_name ?? 'Unknown buyer';

  /** GET /api/merchant/cases */
  function listCases(user, { status, priority, issue_type, q, limit = 50, offset = 0 } = {}) {
    const rows = models.cases.listForMerchant(user.id);
    const ids = rows.map((r) => r.id);
    const recs = models.recommendations.latestForCases(ids);
    const evCounts = models.evidence.countsByCase(ids);

    let items = rows.map((c) => {
      const p = models.payments.findById(c.payment_reference_id);
      const rec = recs.get(c.id) || null;
      return {
        id: c.id,
        status: c.status,
        issue_type: c.issue_type,
        priority: computePriority(c, rec, nowMs()),
        source_mode: c.source_mode,
        buyer: { id: c.buyer_user_id, display_name: buyerName(c.buyer_user_id) },
        payment: p && { id: p.id, paypal_order_id: p.paypal_order_id, amount: p.amount, currency: p.currency, merchant_label: p.merchant_label, source_mode: p.source_mode },
        evidence_count: evCounts.get(c.id) || 0,
        has_recommendation: Boolean(rec),
        possible_duplicate: duplicates.summaryFor(c),
        created_at: c.created_at,
        updated_at: c.updated_at,
      };
    });

    if (status) items = items.filter((i) => status.includes(i.status));
    if (priority) items = items.filter((i) => i.priority === priority);
    if (issue_type) items = items.filter((i) => i.issue_type === issue_type);
    if (q) {
      const needle = q.toLowerCase();
      items = items.filter((i) => [i.id, i.payment?.paypal_order_id, i.buyer.display_name, i.payment?.merchant_label].some((v) => String(v || '').toLowerCase().includes(needle)));
    }
    items.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || Date.parse(b.updated_at) - Date.parse(a.updated_at));

    const counts = items.reduce((acc, i) => ({ ...acc, [i.status]: (acc[i.status] || 0) + 1 }), {});
    return { items: items.slice(offset, offset + limit), total: items.length, counts };
  }

  /** Loads a case only if it belongs to this merchant; otherwise behaves exactly like "not found". */
  function mustOwn(user, caseId) {
    const c = models.cases.findForMerchant(caseId, user.id);
    if (!c || c.status === 'draft') throw notFound('Case');
    return c;
  }

  function buildView(c, user) {
    const payment = paymentView(models.payments.findById(c.payment_reference_id));
    const evidence = models.evidence.listForCase(c.id).map((e) => evidenceView(c, e));
    const rec = models.recommendations.latestForCase(c.id);
    const auditEvents = audit.listForTarget(c.id);
    return {
      case: {
        id: c.id, payment_reference_id: c.payment_reference_id, issue_type: c.issue_type,
        narrative: c.narrative,
        // The buyer's words are a CLAIM. For seeded rows they are synthetic; otherwise they are unverified.
        narrative_source_mode: c.source_mode === 'synthetic_demo' ? 'synthetic_demo' : 'user_provided_unverified',
        status: c.status, source_mode: c.source_mode,
        priority: computePriority(c, rec, nowMs()),
        buyer: { id: c.buyer_user_id, display_name: buyerName(c.buyer_user_id) },
        merchant_draft: c.merchant_draft ?? '',
        reviewed_at: c.reviewed_at, created_at: c.created_at, updated_at: c.updated_at,
        allowed_transitions: TRANSITIONS[c.status] || [],
      },
      payment,
      evidence,
      evidence_gaps: computeEvidenceGaps(c.issue_type, evidence),
      timeline: buildTimeline(c, payment, evidence, rec, auditEvents),
      recommendation: rec,
      duplicate_hints: duplicates.hintsFor(c),
      audit: auditEvents,
    };
  }

  /** GET /api/merchant/cases/:id */
  function getCase(user, caseId) {
    return buildView(mustOwn(user, caseId), user);
  }

  /**
   * PATCH /api/merchant/cases/:id   patch = { status?, merchant_draft? } (already validated)
   * One transaction: ownership check -> idempotency -> transition rules -> write -> case_action -> audit events.
   */
  function updateCase(user, caseId, patch, { idempotencyKey = null } = {}) {
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ s: patch.status ?? null, d: patch.merchant_draft ?? null })).digest('hex').slice(0, 16);

    return models.__tx(() => {
      const c = mustOwn(user, caseId);

      const prior = models.actions.findByKey(c.id, idempotencyKey);
      if (prior) {
        const stored = JSON.parse(prior.result);
        if (stored.fingerprint !== fingerprint) {
          throw unprocessable('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used with a different request.');
        }
        return { view: buildView(c, user), meta: { idempotentReplay: true, changed: false } };
      }

      if (c.status === 'closed') throw conflict('CASE_CLOSED', 'This case is closed and can no longer be changed.');

      const statusChange = patch.status !== undefined && patch.status !== c.status;
      if (statusChange && !TRANSITIONS[c.status].includes(patch.status)) {
        throw conflict('INVALID_TRANSITION', `A ${c.status.replace(/_/g, ' ')} case cannot move to ${patch.status.replace(/_/g, ' ')}.`);
      }

      const draftChange = patch.merchant_draft !== undefined && patch.merchant_draft !== (c.merchant_draft ?? '');
      const effectiveDraft = patch.merchant_draft !== undefined ? patch.merchant_draft : (c.merchant_draft ?? '');

      if (statusChange && patch.status === 'awaiting_information' && !effectiveDraft.trim()) {
        throw unprocessable('MESSAGE_REQUIRED', 'Write the message to the buyer before requesting more information.', [{ field: 'merchant_draft', issue: 'required to request more information' }]);
      }

      if (!statusChange && !draftChange) return { view: buildView(c, user), meta: { idempotentReplay: false, changed: false } };

      const at = now();
      models.cases.updateMerchantFields(c.id, {
        status: statusChange ? patch.status : undefined,
        merchant_draft: draftChange ? effectiveDraft : undefined,
        reviewed_at: statusChange && patch.status === 'under_review' && !c.reviewed_at ? at : undefined,
        updated_at: at,
      });

      models.actions.insert({
        case_id: c.id, actor_id: user.id,
        action_type: statusChange ? `merchant_set_status:${patch.status}` : 'merchant_save_draft',
        result: JSON.stringify({ fingerprint, status: statusChange ? patch.status : c.status, draft_saved: draftChange }),
        idempotency_key: idempotencyKey,
      }, at);

      if (draftChange) {
        // Length only: the draft text itself is not copied into the audit trail.
        audit.record({ actorId: user.id, eventType: AUDIT_EVENTS.MERCHANT_DRAFT_SAVED, targetId: c.id, metadata: { draft_length: effectiveDraft.length } });
      }
      if (statusChange) {
        audit.record({ actorId: user.id, eventType: STATUS_EVENT[patch.status], targetId: c.id, metadata: { from: c.status, to: patch.status } });
      }

      return { view: buildView(models.cases.findById(c.id), user), meta: { idempotentReplay: false, changed: true } };
    });
  }

  return { listCases, getCase, updateCase };
}

module.exports = { createMerchantService, TRANSITIONS, REQUIRED_EVIDENCE, computeEvidenceGaps, computePriority, buildTimeline };
