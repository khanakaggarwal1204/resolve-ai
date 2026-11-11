'use strict';
const { newId } = require('../../utils/ids');

function createCasesRepo(db) {
  const byId = db.prepare('SELECT * FROM resolution_cases WHERE id = ?');
  const byIdForMerchant = db.prepare('SELECT * FROM resolution_cases WHERE id = ? AND merchant_user_id = ?');

  return {
    findById: (id) => byId.get(id) || null,
    /** Ownership is part of the query, so a merchant can never load another merchant's case by ID. */
    findForMerchant: (id, merchantId) => byIdForMerchant.get(id, merchantId) || null,

    /** Cases a merchant may see: theirs, and never a buyer's unsent draft. */
    listForMerchant: (merchantId) =>
      db.prepare("SELECT * FROM resolution_cases WHERE merchant_user_id = ? AND status <> 'draft'").all(merchantId),

    /** Used by Khanak's caseService. Source mode follows the payment: synthetic payment => synthetic case. */
    insert(c, now = new Date().toISOString()) {
      const id = c.id || newId('case');
      db.prepare(`INSERT INTO resolution_cases (id, payment_reference_id, buyer_user_id, merchant_user_id, issue_type, narrative, status, source_mode, merchant_draft, reviewed_at, created_at, updated_at)
                  VALUES (@id, @payment_reference_id, @buyer_user_id, @merchant_user_id, @issue_type, @narrative, @status, @source_mode, NULL, NULL, @created_at, @updated_at)`)
        .run({ narrative: '', status: 'submitted', source_mode: 'app_owned', created_at: now, updated_at: now, ...c, id });
      return byId.get(id);
    },

    /** Merchant-side write. Only these columns can change here. */
    updateMerchantFields(id, { status, merchant_draft, reviewed_at, updated_at }) {
      db.prepare(`UPDATE resolution_cases SET
                    status = COALESCE(@status, status),
                    merchant_draft = CASE WHEN @set_draft = 1 THEN @merchant_draft ELSE merchant_draft END,
                    reviewed_at = COALESCE(@reviewed_at, reviewed_at),
                    updated_at = @updated_at
                  WHERE id = @id`)
        .run({ id, status: status ?? null, set_draft: merchant_draft === undefined ? 0 : 1, merchant_draft: merchant_draft ?? null, reviewed_at: reviewed_at ?? null, updated_at });
      return byId.get(id);
    },
  };
}

module.exports = { createCasesRepo };
