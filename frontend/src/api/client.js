// API client for the Express backend.
// Contract (section 7): every response is { data, error, requestId }.
// VITE_API_MODE:
//   mock   - everything runs on src/api/mock.js (no backend)
//   hybrid - payments hit the real backend; cases/AI/evidence stay mocked (current backend state)
//   live   - everything hits the real backend
// NOTE: the real payments API replies with { payment, transaction, meta } and errors with
// { error: { code, message, retryable, outcome_unknown, debug_id } }. Both that and the
// planned { data, error, requestId } envelope are handled below.
import { mockRequest, hasMockPayment, rememberPayment } from './mock.js';
import { adaptCaseView, adaptPayment, adaptRecommendation } from './adapters.js';

const BASE = import.meta.env.VITE_API_BASE_URL || '/api';
const RAW_MODE = import.meta.env.VITE_API_MODE || (import.meta.env.VITE_USE_MOCK === 'false' ? 'live' : 'mock');
export const API_MODE = ['mock', 'hybrid', 'live'].includes(RAW_MODE) ? RAW_MODE : 'mock';
export const IS_MOCK = API_MODE === 'mock';
export const HAS_LIVE_PAYMENTS = API_MODE !== 'mock';

export class ApiError extends Error {
  constructor(message, { code, requestId, status, retryable, outcomeUnknown } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.requestId = requestId;
    this.status = status;
    this.retryable = Boolean(retryable);
    // True when the server could not confirm what happened (e.g. PayPal timeout).
    // Never treat this as "payment failed".
    this.outcomeUnknown = Boolean(outcomeUnknown);
  }
}

async function request(path, { method = 'GET', body, signal, timeoutMs = 20000, live = false, headers = {} } = {}) {
  // `live` marks calls the real backend already implements (payments).
  if (API_MODE === 'mock' || (API_MODE === 'hybrid' && !live)) return mockRequest(method, path, body);

  // Combine caller's abort signal with a timeout.
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);

  try {
    let res;
    try {
      res = await fetch(`${BASE}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Demo-User': getDemoUser(), ...headers },
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'include',
        signal: ctrl.signal,
      });
    } catch (e) {
      if (timedOut) {
        throw new ApiError('The server took too long to respond. Please try again.', { code: 'TIMEOUT' });
      }
      if (e.name === 'AbortError') throw e; // cancelled by caller/unmount
      throw new ApiError('Could not reach the server. Check your connection and try again.', { code: 'NETWORK_ERROR' });
    }

    let envelope = null;
    try { envelope = await res.json(); } catch { /* non-JSON error body */ }

    if (!res.ok || envelope?.error) {
      const err = envelope?.error;
      throw new ApiError(err?.message || `Request failed (${res.status}).`, {
        code: err?.code,
        requestId: envelope?.requestId ?? err?.debug_id,
        status: res.status,
        retryable: err?.retryable,
        outcomeUnknown: err?.outcome_unknown,
      });
    }
    // Planned envelope -> unwrap `data`; current payments API -> return the body as is.
    return envelope && 'data' in envelope ? envelope.data : envelope;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

const enc = encodeURIComponent;

// Demo-only identity. The backend (DEMO_MODE=true) trusts this header; it is NOT real authentication.
export const DEMO_USERS = [
  { id: 'user_merchant_demo', label: 'Demo Store (merchant)', role: 'merchant' },
  { id: 'user_merchant_other', label: 'Other Shop (merchant)', role: 'merchant' },
  { id: 'user_buyer_alice', label: 'Alice Demo (buyer)', role: 'buyer' },
  { id: 'user_buyer_ben', label: 'Ben Demo (buyer)', role: 'buyer' },
];
const DEMO_USER_KEY = 'resolve_demo_user';
export function getDemoUser() {
  try { return localStorage.getItem(DEMO_USER_KEY) || 'user_merchant_demo'; } catch { return 'user_merchant_demo'; }
}
export function setDemoUser(id) {
  try { localStorage.setItem(DEMO_USER_KEY, id); } catch { /* storage unavailable: keep the default user */ }
}

const mockOnly = (method, path, body) => mockRequest(method, path, body);

export const api = {
  // --- Payments (Kavya) ---
  // Real backend: GET /api/payments/orders/:orderId (no list endpoint exists yet).
  listPayments: async (opts) => {
    if (API_MODE !== 'live') return mockOnly('GET', '/payments');
    try {
      return (await request('/payments', { ...opts, live: true })).map(adaptPayment);
    } catch (e) {
      if (e.status === 404) return []; // list endpoint not built yet
      throw e;
    }
  },
  getPayment: async (id, opts) => {
    if (API_MODE === 'mock' || (API_MODE === 'hybrid' && hasMockPayment(id))) {
      return mockOnly('GET', `/payments/${enc(id)}`);
    }
    const payment = adaptPayment(await request(`/payments/orders/${enc(id)}`, { ...opts, live: true }));
    rememberPayment(payment); // lets the mocked case flow link to a real sandbox order
    return payment;
  },

  // --- Cases (Khanak / Kashish): routes not built in the backend yet ---
  // ASSUMPTION: GET /api/cases returns the signed-in buyer's own cases.
  listMyCases: (opts) => request('/cases', opts),
  createCase: (payload) => request('/cases', { method: 'POST', body: payload }),
  getCase: async (id, opts) => adaptCaseView(await request(`/cases/${enc(id)}`, opts)),
  analyzeCase: async (id) => adaptRecommendation(await request(`/cases/${enc(id)}/analyze`, { method: 'POST', timeoutMs: 60000 })),
  generateDraft: (id) => request(`/cases/${enc(id)}/draft-response`, { method: 'POST', timeoutMs: 60000 }),
  // Saves an app-owned action only; never a refund/dispute. Uses an idempotency key.
  recordAction: (id, payload) => request(`/cases/${enc(id)}/actions`, { method: 'POST', body: payload }),
  // --- Merchant portal (Kashish). Hybrid mode keeps these mocked, like the other case routes. ---
  listMerchantCases: (params = {}, opts) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '')).toString();
    return request(`/merchant/cases${qs ? `?${qs}` : ''}`, opts);
  },
  getMerchantCase: async (id, opts) => adaptCaseView(await request(`/merchant/cases/${enc(id)}`, opts)),
  // patch = { status?, merchant_draft? }. App record only: never a refund or PayPal dispute action.
  updateMerchantCase: async (id, patch, idempotencyKey) =>
    adaptCaseView(await request(`/merchant/cases/${enc(id)}`, { method: 'PATCH', body: patch, headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {} })),

  // ASSUMPTION: evidence metadata endpoint. Not in the plan's 4.2 yet. Agree with Kashish.
  addEvidence: (id, payload) => request(`/cases/${enc(id)}/evidence`, { method: 'POST', body: payload }),
};
