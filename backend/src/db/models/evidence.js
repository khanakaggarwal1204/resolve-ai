'use strict';
const { newId } = require('../../utils/ids');

function createEvidenceRepo(db) {
  return {
    listForCase: (caseId) => db.prepare('SELECT * FROM evidence_items WHERE case_id = ? ORDER BY created_at ASC').all(caseId),
    countsByCase: (caseIds) => {
      if (!caseIds.length) return new Map();
      const marks = caseIds.map(() => '?').join(',');
      const rows = db.prepare(`SELECT case_id, COUNT(*) AS n FROM evidence_items WHERE case_id IN (${marks}) GROUP BY case_id`).all(...caseIds);
      return new Map(rows.map((r) => [r.case_id, r.n]));
    },
    /** MVP stores metadata only (no file binaries). verified_at stays NULL unless the APP itself verified it. */
    insert(e, now = new Date().toISOString()) {
      const id = e.id || newId('ev');
      db.prepare(`INSERT INTO evidence_items (id, case_id, type, description, source, verified_at, attached_by, created_at)
                  VALUES (@id, @case_id, @type, @description, @source, @verified_at, @attached_by, @created_at)`)
        .run({ verified_at: null, created_at: now, ...e, id });
      return id;
    },
  };
}

module.exports = { createEvidenceRepo };
