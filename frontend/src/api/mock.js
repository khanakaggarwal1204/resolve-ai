// In-memory mock of the backend so the buyer UI can be built and demoed alone.
// Shapes follow section 4.3 (data model) + section 7 (enums). Everything here is
// SYNTHETIC. Never describe it as a live PayPal dispute.
import { ApiError } from './client.js';

const delay = (ms = 450) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();
const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();

const payments = [
  {
    id: 'pay_001',
    paypal_order_id: '5O190127TN364715T',
    capture_id: '3C679366HH908993F',
    amount: '49.99',
    currency: 'USD',
    verified_status: 'COMPLETED',
    merchant_label: 'Demo Store · Wireless Headphones',
    source_mode: 'paypal_sandbox_verified',
    created_at: hoursAgo(96),
  },
  {
    id: 'pay_002',
    paypal_order_id: 'DEMO-ORD-0002',
    capture_id: null,
    amount: '19.00',
    currency: 'USD',
    verified_status: 'COMPLETED',
    merchant_label: 'Demo Store · Phone Case',
    source_mode: 'synthetic_demo',
    created_at: hoursAgo(200),
  },
  {
    id: 'pay_003',
    paypal_order_id: 'DEMO-ORD-0003',
    capture_id: null,
    amount: '120.00',
    currency: 'EUR',
    verified_status: 'COMPLETED',
    merchant_label: 'Demo Store · Desk Lamp',
    source_mode: 'synthetic_demo',
    created_at: hoursAgo(300),
  },
];

const cases = [];
const evidence = {}; // caseId -> []
const recs = {}; // caseId -> recommendation
const drafts = {}; // caseId -> saved buyer draft
const audit = {}; // caseId -> []
let seq = 1;

const findPayment = (id) => payments.find((p) => p.id === id);
export const hasMockPayment = (id) => Boolean(findPayment(id));
// Remember a real (server-verified) payment so mocked cases can link to it.
export function rememberPayment(p) {
  if (p?.id && !findPayment(p.id)) payments.unshift(p);
}
const findCase = (id) => {
  const c = cases.find((x) => x.id === id);
  if (!c) throw new ApiError('Case not found.', { code: 'NOT_FOUND', status: 404 });
  return c;
};
const log = (caseId, event_type) =>
  (audit[caseId] ||= []).push({ id: `aud_${Math.random().toString(36).slice(2, 8)}`, event_type, timestamp: now() });

const GAPS = {
  not_received: ['Tracking number or carrier confirmation', 'Estimated delivery date shown at checkout', 'Any message sent to the merchant about delivery'],
  duplicate_charge: ['Bank/card statement showing both charges', 'Second order or capture ID, if one exists', 'Order confirmation emails'],
  incorrect_amount: ['Itemised order confirmation or invoice', 'Screenshot of the price at checkout'],
  cancelled_order: ['Cancellation confirmation or email', 'Time and date the cancellation was requested'],
  other: ['Order confirmation', 'Any correspondence with the merchant'],
};

function buildRecommendation(c) {
  const p = findPayment(c.payment_reference_id);
  const verified = p.source_mode === 'paypal_sandbox_verified';
  const items = evidence[c.id] || [];
  const gaps = GAPS[c.issue_type].filter(
    (g) => !items.some((e) => e.description.toLowerCase().includes(g.split(' ')[0].toLowerCase()))
  );
  return {
    id: `rec_${c.id}`,
    case_id: c.id,
    summary: `The buyer reports "${c.issue_type.replace(/_/g, ' ')}" for a ${p.amount} ${p.currency} payment to ${p.merchant_label}. ${
      verified ? 'The payment itself is verified in the PayPal sandbox.' : 'This order is synthetic demo data, so payment facts are not verified.'
    } Fulfilment details are not yet available to the app.`,
    verified_facts: [
      { statement: `Payment status is ${p.verified_status}.`, source_field: 'payment.verified_status', source_mode: p.source_mode },
      { statement: `Amount is ${p.amount} ${p.currency}.`, source_field: 'payment.amount', source_mode: p.source_mode },
      { statement: `The case was opened by the buyer on ${new Date(c.created_at).toLocaleDateString()}.`, source_field: 'case.created_at', source_mode: 'app_owned' },
    ],
    unknowns: ['Whether the merchant has shipped or fulfilled the order', 'Whether the buyer has already contacted the merchant'],
    evidence_gaps: gaps,
    suggested_next_step: 'Gather the missing evidence below, then send the neutral message to the merchant and allow a reasonable time for a reply.',
    draft_message: `Hello,\n\nI'm contacting you about my recent order (${p.merchant_label}, ${p.amount} ${p.currency}). ${
      c.narrative ? c.narrative + '\n\n' : ''
    }Could you please confirm the current status and let me know what information you need from me to help resolve this?\n\nThank you.`,
    caution: 'This is an AI-generated summary of the information supplied. It does not decide who is right, and it cannot start a refund or an official PayPal dispute.',
    confidence_label: verified ? 'Medium' : 'Low (synthetic data)',
    model_version: 'mock-v1',
    is_fallback: false,
    created_at: now(),
  };
}

function buildTimeline(c) {
  const p = findPayment(c.payment_reference_id);
  const t = [
    { id: 't1', label: `Payment ${p.verified_status.toLowerCase()} (${p.amount} ${p.currency})`, timestamp: p.created_at, source_mode: p.source_mode },
    { id: 't2', label: 'Case opened by buyer', timestamp: c.created_at, source_mode: 'app_owned' },
  ];
  (evidence[c.id] || []).forEach((e) =>
    t.push({ id: `t_${e.id}`, label: `Evidence added: ${e.description}`, timestamp: e.created_at, source_mode: 'user_provided_unverified' })
  );
  if (recs[c.id]) t.push({ id: 't_ai', label: 'AI brief generated', timestamp: recs[c.id].created_at, source_mode: 'app_owned' });
  return t.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

const caseView = (c) => ({
  case: { ...c, saved_buyer_draft: drafts[c.id] ?? null },
  payment: findPayment(c.payment_reference_id),
  evidence: evidence[c.id] || [],
  timeline: buildTimeline(c),
  recommendation: recs[c.id] ?? null,
  audit: audit[c.id] || [],
});

export async function mockRequest(method, path, body) {
  await delay(path.endsWith('/analyze') || path.endsWith('/draft-response') ? 1100 : 450);
  const parts = path.split('?')[0].split('/').filter(Boolean);

  if (method === 'GET' && parts[0] === 'payments' && !parts[1]) return payments;
  if (method === 'GET' && parts[0] === 'payments') {
    const p = findPayment(decodeURIComponent(parts[1]));
    if (!p) throw new ApiError('Payment not found.', { code: 'NOT_FOUND', status: 404 });
    return p;
  }
  if (method === 'GET' && parts[0] === 'cases' && !parts[1]) return cases.slice().reverse();

  if (method === 'POST' && parts[0] === 'cases' && !parts[1]) {
    if (!findPayment(body.payment_reference_id)) throw new ApiError('Payment not found.', { code: 'NOT_FOUND', status: 404 });
    if (cases.some((c) => c.payment_reference_id === body.payment_reference_id && c.issue_type === body.issue_type && !['resolved', 'closed'].includes(c.status))) {
      throw new ApiError('You already have an open case for this order and issue type.', { code: 'DUPLICATE_CASE', status: 409 });
    }
    const p = findPayment(body.payment_reference_id);
    const c = {
      id: `case_${String(seq++).padStart(3, '0')}`,
      payment_reference_id: body.payment_reference_id,
      issue_type: body.issue_type,
      narrative: body.narrative || '',
      status: 'submitted',
      source_mode: p.source_mode === 'synthetic_demo' ? 'synthetic_demo' : 'app_owned',
      created_at: now(),
      updated_at: now(),
    };
    cases.push(c);
    log(c.id, 'case_created');
    return c;
  }

  if (parts[0] === 'cases' && parts[1]) {
    const c = findCase(parts[1]);
    if (method === 'GET' && !parts[2]) return caseView(c);
    if (method === 'POST' && parts[2] === 'analyze') {
      recs[c.id] = buildRecommendation(c);
      log(c.id, 'analysis_generated');
      return recs[c.id];
    }
    if (method === 'POST' && parts[2] === 'draft-response') {
      recs[c.id] = { ...(recs[c.id] ?? buildRecommendation(c)), draft_message: buildRecommendation(c).draft_message };
      log(c.id, 'draft_generated');
      return { draft_message: recs[c.id].draft_message };
    }
    if (method === 'POST' && parts[2] === 'actions') {
      if (!body?.idempotency_key) throw new ApiError('Missing idempotency key.', { code: 'VALIDATION_ERROR', status: 422 });
      if (body.action_type === 'save_buyer_draft') drafts[c.id] = body.payload?.draft_message ?? '';
      log(c.id, body.action_type);
      return { id: `act_${Date.now()}`, action_type: body.action_type, result: 'recorded', approved_at: now() };
    }
    if (method === 'POST' && parts[2] === 'evidence') {
      const item = {
        id: `ev_${Math.random().toString(36).slice(2, 8)}`,
        case_id: c.id,
        type: body.type,
        description: body.description,
        source: 'buyer',
        verified_at: null,
        attached_by: 'buyer',
        created_at: now(),
        source_mode: 'user_provided_unverified',
      };
      (evidence[c.id] ||= []).push(item);
      log(c.id, 'evidence_added');
      return item;
    }
  }
  throw new ApiError(`No mock for ${method} ${path}`, { code: 'NOT_FOUND', status: 404 });
}
