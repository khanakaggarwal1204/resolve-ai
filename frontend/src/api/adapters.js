// Adapters turn whatever the backend actually returns into the view models the UI uses.
// Keeping this in one place means backend shape changes only touch this file.

// ---- Payments -------------------------------------------------------------
// Backend (Kavya) returns { payment, transaction, meta } with camelCase fields, e.g.
//   payment: { orderId, captureId, state, providerStatus:{order,capture}, amount:{value,currency},
//              createdAt, merchantLabel, environment, statusReason }
// UI shape: { id, paypal_order_id, capture_id, amount, currency, verified_status, state,
//             merchant_label, source_mode, created_at, status_reason }
export function adaptPayment(raw) {
  if (!raw) return raw;
  if (raw.verified_status) return raw; // already the UI/mock shape
  const p = raw.payment ?? raw;
  const status = p.providerStatus?.capture || p.providerStatus?.order || p.state || 'unknown';
  return {
    id: p.orderId ?? p.captureId,
    paypal_order_id: p.orderId ?? null,
    capture_id: p.captureId ?? null,
    amount: p.amount?.value != null ? String(p.amount.value) : '',
    currency: p.amount?.currency ?? '',
    verified_status: String(status).toUpperCase(),
    state: p.state ?? 'unknown',
    merchant_label: p.merchantLabel || 'Sandbox order',
    // Data fetched from PayPal itself by the server is the only thing we call "verified".
    source_mode: p.environment === 'sandbox' ? 'paypal_sandbox_verified' : 'app_owned',
    created_at: p.createdAt ?? null,
    status_reason: p.statusReason ?? null,
  };
}

// ---- AI recommendation ----------------------------------------------------
// Two shapes are supported:
//  (a) build-plan shape: { summary, verified_facts, unknowns, evidence_gaps, suggested_next_step, draft_message, caution }
//  (b) Khanak's analyzer shape (see backend/src/services/ai/tests/caseAnalyzer.test.js):
//      { issue:{category,summary,confidence}, verified_facts[{statement,source_field,source_value,provenance}],
//        unverified_claims[], missing_information[{item,why_needed,requested_from}], contradictions[],
//        urgency{level,reasons}, recommended_actions[{action_code,description,owner,requires_human_approval}],
//        human_review{required,reasons}, caution, analysis_status, meta{used_fallback} }
const PROVENANCE_TO_SOURCE = {
  paypal_verified: 'paypal_sandbox_verified',
  app_record: 'app_owned',
  app_owned: 'app_owned',
  user_provided: 'user_provided_unverified',
};

export function adaptRecommendation(raw) {
  if (!raw) return null;
  if (!raw.issue) {
    // plan shape: pass through with safe defaults
    return { unverified_claims: [], recommended_actions: [], contradictions: [], ...raw };
  }
  const actions = raw.recommended_actions ?? [];
  return {
    summary: raw.issue.summary,
    verified_facts: (raw.verified_facts ?? []).map((f) => ({
      statement: f.statement,
      source_field: f.source_field,
      source_mode: PROVENANCE_TO_SOURCE[f.provenance] ?? undefined,
    })),
    unverified_claims: raw.unverified_claims ?? [],
    unknowns: [],
    evidence_gaps: (raw.missing_information ?? []).map((m) =>
      m.why_needed ? `${m.item}: ${m.why_needed}` : m.item
    ),
    contradictions: (raw.contradictions ?? []).map(
      (c) => c.description ?? c.summary ?? c.statement ?? 'A possible inconsistency was noted.'
    ),
    recommended_actions: actions,
    suggested_next_step: actions[0]?.description ?? 'Gather the missing information, then contact the merchant.',
    urgency: raw.urgency ?? null,
    human_review: raw.human_review ?? null,
    draft_message: raw.draft_message ?? null,
    caution: raw.caution,
    confidence_label: raw.issue.confidence,
    model_version: raw.meta?.model_version ?? raw.meta?.model ?? null,
    is_fallback: Boolean(raw.meta?.used_fallback) || raw.analysis_status === 'fallback',
    created_at: raw.created_at ?? null,
  };
}

export function adaptCaseView(raw) {
  if (!raw) return raw;
  return { ...raw, recommendation: adaptRecommendation(raw.recommendation) };
}
