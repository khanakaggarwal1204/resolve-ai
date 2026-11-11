'use strict';

/**
 * Demo seed. EVERYTHING here is synthetic and labelled source_mode='synthetic_demo'.
 * These are NOT live PayPal disputes and the payment rows are NOT real PayPal transactions
 * (they use DEMO-ORD-* IDs). A sandbox-verified payment reference is only ever written by
 * paymentReferences.upsertVerified() after the server has fetched the order from PayPal.
 * Safe to run twice (INSERT OR IGNORE). Use `npm run db:reset` for a clean slate.
 * No real personal, financial or card data: names are made up, no emails or phone numbers.
 */
const { createModels } = require('./models');

const HOUR = 3600e3;
const DEMO_USERS = [
  { id: 'user_buyer_alice', role: 'buyer', display_name: 'Alice Demo (buyer)' },
  { id: 'user_buyer_ben', role: 'buyer', display_name: 'Ben Demo (buyer)' },
  { id: 'user_merchant_demo', role: 'merchant', display_name: 'Demo Store (merchant)', merchant_label: 'Demo Store' },
  { id: 'user_merchant_other', role: 'merchant', display_name: 'Other Shop (merchant)', merchant_label: 'Other Shop' },
];

function seedDemo(db, { now = Date.now() } = {}) {
  const models = createModels(db);
  const ago = (h) => new Date(now - h * HOUR).toISOString();

  const payments = [
    { id: 'pay_demo_001', paypal_order_id: 'DEMO-ORD-0001', amount: '49.99', currency: 'USD', verified_status: 'COMPLETED', merchant_label: 'Demo Store · Wireless Headphones', created_at: ago(120) },
    { id: 'pay_demo_002', paypal_order_id: 'DEMO-ORD-0002', amount: '19.00', currency: 'USD', verified_status: 'COMPLETED', merchant_label: 'Demo Store · Phone Case', created_at: ago(200) },
    { id: 'pay_demo_003', paypal_order_id: 'DEMO-ORD-0003', amount: '120.00', currency: 'EUR', verified_status: 'COMPLETED', merchant_label: 'Demo Store · Desk Lamp', created_at: ago(300) },
    { id: 'pay_demo_004', paypal_order_id: 'DEMO-ORD-0004', amount: '35.50', currency: 'USD', verified_status: 'COMPLETED', merchant_label: 'Demo Store · Notebook Set', created_at: ago(60) },
    { id: 'pay_demo_005', paypal_order_id: 'DEMO-ORD-0005', amount: '75.00', currency: 'USD', verified_status: 'COMPLETED', merchant_label: 'Other Shop · Backpack', created_at: ago(30) },
  ];

  const cases = [
    // Alice + same payment as case 002 (-> "same payment reference" hint) and similar story to case 004 (-> issue-type + wording hints).
    { id: 'case_demo_001', payment_reference_id: 'pay_demo_001', buyer_user_id: 'user_buyer_alice', merchant_user_id: 'user_merchant_demo', issue_type: 'not_received', status: 'submitted', created_at: ago(100),
      narrative: 'My wireless headphones order has not arrived and the tracking page shows nothing new for over a week.' },
    { id: 'case_demo_002', payment_reference_id: 'pay_demo_001', buyer_user_id: 'user_buyer_alice', merchant_user_id: 'user_merchant_demo', issue_type: 'duplicate_charge', status: 'submitted', created_at: ago(90),
      narrative: 'I think I was charged twice for the headphones.' },
    // Under review, deliberately NO evidence (-> evidence gaps).
    { id: 'case_demo_003', payment_reference_id: 'pay_demo_003', buyer_user_id: 'user_buyer_ben', merchant_user_id: 'user_merchant_demo', issue_type: 'incorrect_amount', status: 'under_review', created_at: ago(80), reviewed_at: ago(70),
      narrative: 'The lamp showed 99.00 at checkout but I was charged 120.00.' },
    { id: 'case_demo_004', payment_reference_id: 'pay_demo_004', buyer_user_id: 'user_buyer_alice', merchant_user_id: 'user_merchant_demo', issue_type: 'not_received', status: 'awaiting_information', created_at: ago(50), merchant_draft: 'Hello, could you share the tracking number or carrier confirmation you received? Thank you.',
      narrative: 'My notebook order has not arrived and the tracking page shows nothing new for over a week.' },
    // Finished case (-> low priority).
    { id: 'case_demo_005', payment_reference_id: 'pay_demo_002', buyer_user_id: 'user_buyer_ben', merchant_user_id: 'user_merchant_demo', issue_type: 'cancelled_order', status: 'resolved', created_at: ago(190), reviewed_at: ago(180),
      narrative: 'I cancelled right after ordering but the order still shows as active.' },
    // Belongs to ANOTHER merchant: used to prove ownership checks (Demo Store must never see it).
    { id: 'case_demo_006', payment_reference_id: 'pay_demo_005', buyer_user_id: 'user_buyer_ben', merchant_user_id: 'user_merchant_other', issue_type: 'other', status: 'submitted', created_at: ago(20),
      narrative: 'The backpack zipper arrived broken.' },
  ];

  const evidence = [
    { id: 'ev_demo_001', case_id: 'case_demo_001', type: 'order_confirmation', description: 'Order confirmation email (synthetic)', source: 'buyer', attached_by: 'user_buyer_alice', created_at: ago(99) },
    { id: 'ev_demo_002', case_id: 'case_demo_004', type: 'order_confirmation', description: 'Receipt for notebook set (synthetic)', source: 'buyer', attached_by: 'user_buyer_alice', created_at: ago(49) },
  ];

  const recommendation = {
    summary: 'The buyer reports that the order has not arrived. The payment is a synthetic demo record, so no payment facts are verified. No delivery information has been supplied.',
    verified_facts: [{ statement: 'The demo payment is recorded as COMPLETED.', source_field: 'payment.verified_status', source_mode: 'synthetic_demo' }],
    unknowns: ['Whether the merchant has shipped the order'],
    evidence_gaps: ['Tracking number or carrier confirmation: needed to check whether the order was fulfilled.'],
    suggested_next_step: 'Ask the merchant for fulfilment proof, then compare it with what the buyer describes.',
    draft_message: 'Hello, thank you for getting in touch. Could you share the tracking details for this order so we can look into it together?',
    caution: 'Synthetic demo content. This summary does not decide who is right and cannot start a refund or an official PayPal dispute.',
    confidence_label: 'Low (synthetic data)',
    model_version: 'seed-v1',
    urgency: { level: 'medium', reasons: ['Seeded example.'] },
    is_fallback: true,
  };

  db.transaction(() => {
    for (const u of DEMO_USERS) db.prepare('INSERT OR IGNORE INTO users (id, role, display_name, merchant_label, source_mode, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(u.id, u.role, u.display_name, u.merchant_label || null, 'synthetic_demo', ago(400));
    for (const p of payments) models.payments.insertSynthetic(p);
    for (const c of cases) {
      db.prepare(`INSERT OR IGNORE INTO resolution_cases (id, payment_reference_id, buyer_user_id, merchant_user_id, issue_type, narrative, status, source_mode, merchant_draft, reviewed_at, created_at, updated_at)
                  VALUES (@id, @payment_reference_id, @buyer_user_id, @merchant_user_id, @issue_type, @narrative, @status, 'synthetic_demo', @merchant_draft, @reviewed_at, @created_at, @created_at)`)
        .run({ merchant_draft: null, reviewed_at: null, ...c });
      db.prepare('INSERT OR IGNORE INTO audit_events (id, actor_id, event_type, target_id, timestamp, metadata_redacted) VALUES (?, ?, ?, ?, ?, ?)')
        .run(`aud_${c.id}_created`, c.buyer_user_id, 'case_created', c.id, c.created_at, JSON.stringify({ source_mode: 'synthetic_demo' }));
    }
    for (const e of evidence) db.prepare('INSERT OR IGNORE INTO evidence_items (id, case_id, type, description, source, verified_at, attached_by, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)')
      .run(e.id, e.case_id, e.type, e.description, e.source, e.attached_by, e.created_at);
    if (!models.recommendations.latestForCase('case_demo_001')) models.recommendations.insert('case_demo_001', recommendation, ago(95));
  })();

  return { users: DEMO_USERS.length, payments: payments.length, cases: cases.length, evidence: evidence.length };
}

module.exports = { seedDemo, DEMO_USERS };

if (require.main === module) {
  const { loadEnv } = require('../config/env');
  const { openDatabase } = require('./index');
  const cfg = loadEnv();
  if (!cfg.demoMode) { console.error('Refusing to seed: set DEMO_MODE=true (seed data is synthetic and for demos only).'); process.exit(1); }
  const db = openDatabase(cfg.databaseFile);
  console.log('Seeded synthetic demo data:', seedDemo(db));
  console.log('Demo users: user_merchant_demo (merchant), user_merchant_other (merchant), user_buyer_alice, user_buyer_ben');
  db.close();
}
