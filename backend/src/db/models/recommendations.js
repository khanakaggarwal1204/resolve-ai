'use strict';
const { newId } = require('../../utils/ids');

const parse = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };

/** DB row -> plan-shape recommendation (+ analyzer extras). The frontend adapter accepts this shape as is. */
function toRecommendation(row) {
  if (!row) return null;
  const extras = parse(row.extras_json, {});
  return {
    id: row.id,
    case_id: row.case_id,
    summary: row.summary,
    verified_facts: parse(row.verified_facts_json, []),
    unknowns: parse(row.unknowns_json, []),
    evidence_gaps: parse(row.evidence_gaps_json, []),
    suggested_next_step: row.suggested_next_step,
    draft_message: row.draft_message,
    confidence_label: row.confidence_label,
    model_version: row.model_version,
    created_at: row.created_at,
    ...extras, // unverified_claims, contradictions, recommended_actions, urgency, human_review, caution, is_fallback
  };
}

function createRecommendationsRepo(db) {
  const latestStmt = db.prepare('SELECT * FROM ai_recommendations WHERE case_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1');
  return {
    latestForCase: (caseId) => toRecommendation(latestStmt.get(caseId)),
    /** Latest recommendation for many cases at once (inbox). */
    latestForCases(caseIds) {
      const out = new Map();
      for (const id of caseIds) { const r = toRecommendation(latestStmt.get(id)); if (r) out.set(id, r); }
      return out;
    },
    /**
     * Khanak's aiService calls this AFTER backend validation, so only validated JSON is stored.
     * Accepts the plan shape; anything extra is kept in extras_json.
     */
    insert(caseId, rec, now = new Date().toISOString()) {
      const { summary, verified_facts, unknowns, evidence_gaps, suggested_next_step, draft_message, confidence_label, model_version, ...extras } = rec;
      const id = newId('rec');
      db.prepare(`INSERT INTO ai_recommendations (id, case_id, summary, verified_facts_json, unknowns_json, evidence_gaps_json, suggested_next_step, draft_message, confidence_label, model_version, extras_json, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, caseId, summary || '', JSON.stringify(verified_facts || []), JSON.stringify(unknowns || []), JSON.stringify(evidence_gaps || []),
          suggested_next_step || '', draft_message ?? null, confidence_label ?? null, model_version ?? null, JSON.stringify(extras), now);
      return id;
    },
  };
}

module.exports = { createRecommendationsRepo, toRecommendation };
