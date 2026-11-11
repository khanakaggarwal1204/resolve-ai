'use strict';
const { newId } = require('../utils/ids');
const { redact } = require('../utils/redact');

/** Event types the app writes. Add new ones here so the trail stays greppable. */
const AUDIT_EVENTS = Object.freeze({
  CASE_CREATED: 'case_created',
  ANALYSIS_GENERATED: 'analysis_generated',
  DRAFT_GENERATED: 'draft_generated',
  BUYER_DRAFT_SAVED: 'buyer_draft_saved',
  EVIDENCE_ADDED: 'evidence_added',
  MERCHANT_DRAFT_SAVED: 'merchant_draft_saved',
  MERCHANT_REVIEWED: 'merchant_reviewed',
  MERCHANT_REQUESTED_INFORMATION: 'merchant_requested_information',
  CASE_RESOLVED: 'case_resolved',
  CASE_CLOSED: 'case_closed',
  ACTION_APPROVED: 'action_approved',
});

const parse = (s) => { try { return JSON.parse(s); } catch { return {}; } };

/**
 * Append-only audit trail. Stores actor, action, target, timestamp and REDACTED metadata.
 * Credentials are never stored: secret-looking keys are masked, emails/card-like numbers are scrubbed,
 * long strings are truncated (so a whole narrative or draft is never copied into the trail).
 * The database also blocks UPDATE/DELETE on this table with triggers.
 */
function createAuditService({ db, now = () => new Date().toISOString() }) {
  const insert = db.prepare('INSERT INTO audit_events (id, actor_id, event_type, target_id, timestamp, metadata_redacted) VALUES (?, ?, ?, ?, ?, ?)');
  const list = db.prepare('SELECT * FROM audit_events WHERE target_id = ? ORDER BY timestamp ASC, rowid ASC');

  return {
    record({ actorId, eventType, targetId, metadata = {} }) {
      if (!actorId || !eventType || !targetId) throw new Error('audit.record needs actorId, eventType and targetId');
      const id = newId('aud');
      insert.run(id, actorId, eventType, targetId, now(), JSON.stringify(redact(metadata)));
      return id;
    },
    listForTarget: (targetId) =>
      list.all(targetId).map((r) => ({ id: r.id, actor_id: r.actor_id, event_type: r.event_type, target_id: r.target_id, timestamp: r.timestamp, metadata: parse(r.metadata_redacted) })),
  };
}

module.exports = { createAuditService, AUDIT_EVENTS };
