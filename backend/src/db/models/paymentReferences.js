'use strict';
const { newId } = require('../../utils/ids');

function createPaymentReferencesRepo(db) {
  const byId = db.prepare('SELECT * FROM payment_references WHERE id = ?');
  const byOrder = db.prepare('SELECT * FROM payment_references WHERE paypal_order_id = ?');

  return {
    findById: (id) => byId.get(id) || null,
    findByOrderId: (orderId) => byOrder.get(orderId) || null,

    /**
     * Store a payment fact that SERVER CODE just fetched from PayPal (Kavya's paymentService normalizes it).
     * Never call this with data that came from a request body: that is how a client could forge status/amount.
     * `payment` is the normalized object: { orderId, captureId, amount: {value, currency}, providerStatus, merchantLabel, createdAt }.
     */
    upsertVerified(payment, now = new Date().toISOString()) {
      if (!payment || !payment.orderId || payment.amount?.value == null || !payment.amount?.currency) {
        throw new Error('upsertVerified needs a normalized PayPal payment (orderId + amount).');
      }
      const status = String(payment.providerStatus?.capture || payment.providerStatus?.order || payment.state || 'UNKNOWN').toUpperCase();
      const row = {
        paypal_order_id: payment.orderId,
        capture_id: payment.captureId || null,
        amount: Number(payment.amount.value).toFixed(2),
        currency: String(payment.amount.currency).toUpperCase(),
        verified_status: status,
        merchant_label: payment.merchantLabel || null,
        created_at: payment.createdAt || now,
      };
      const existing = byOrder.get(row.paypal_order_id);
      if (existing) {
        db.prepare('UPDATE payment_references SET capture_id=@capture_id, verified_status=@verified_status, amount=@amount, currency=@currency, merchant_label=COALESCE(@merchant_label, merchant_label) WHERE id=@id')
          .run({ ...row, id: existing.id });
        return byId.get(existing.id);
      }
      const id = newId('pay');
      db.prepare(`INSERT INTO payment_references (id, paypal_order_id, capture_id, amount, currency, verified_status, merchant_label, created_at, source_mode)
                  VALUES (@id, @paypal_order_id, @capture_id, @amount, @currency, @verified_status, @merchant_label, @created_at, 'paypal_sandbox_verified')`)
        .run({ id, ...row });
      return byId.get(id);
    },

    /** Synthetic rows are only for DEMO_MODE seeds and are always labelled synthetic_demo. */
    insertSynthetic(p) {
      db.prepare(`INSERT OR IGNORE INTO payment_references (id, paypal_order_id, capture_id, amount, currency, verified_status, merchant_label, created_at, source_mode)
                  VALUES (@id, @paypal_order_id, NULL, @amount, @currency, @verified_status, @merchant_label, @created_at, 'synthetic_demo')`).run(p);
    },
  };
}

module.exports = { createPaymentReferencesRepo };
