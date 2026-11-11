'use strict';
const { newId } = require('../../utils/ids');

function createActionsRepo(db) {
  const byKey = db.prepare('SELECT * FROM case_actions WHERE case_id = ? AND idempotency_key = ?');
  return {
    findByKey: (caseId, key) => (key ? byKey.get(caseId, key) || null : null),
    listForCase: (caseId) => db.prepare('SELECT * FROM case_actions WHERE case_id = ? ORDER BY approved_at ASC').all(caseId),
    /** Records an APP action only (never a refund or PayPal dispute). The UNIQUE(case_id, idempotency_key) index blocks duplicates. */
    insert({ case_id, actor_id, action_type, result, idempotency_key = null }, now = new Date().toISOString()) {
      const id = newId('act');
      db.prepare('INSERT INTO case_actions (id, case_id, actor_id, action_type, approved_at, result, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, case_id, actor_id, action_type, now, result, idempotency_key);
      return id;
    },
  };
}

module.exports = { createActionsRepo };
