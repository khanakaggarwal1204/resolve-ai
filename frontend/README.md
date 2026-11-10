# PayPal Resolve: Buyer Frontend (Rajrita)

React (Vite) frontend for the **buyer experience** in the PayPal Resolve hackathon build plan.

> Not PayPal's official Resolution Center. Seeded orders are synthetic, not live disputes. No refunds or formal disputes are triggered.

## What's included
| Plan item | Where |
| --- | --- |
| Buyer home (orders with amount, currency, label, verified status) | `src/pages/BuyerHome.jsx` |
| Case intake (issue type + optional narrative) | `src/pages/CaseIntake.jsx` |
| AI brief (summary, verified facts + source chips, unknowns, next step, caution) | `src/components/AIBrief.jsx` |
| Evidence checklist (missing vs. user-provided, marked unverified) | `src/components/EvidenceChecklist.jsx` |
| Editable draft message (copy / save / regenerate) | `src/components/DraftEditor.jsx` |
| Source labels from `source_mode` | `src/components/Badges.jsx` |
| Loading / error / empty states | `src/components/States.jsx` |
| API client (`{ data, error, requestId }` envelope, timeouts) | `src/api/client.js` |
| Mock backend for solo development | `src/api/mock.js` |

## Setup
```bash
cd frontend
npm install
cp .env.example .env
npm run dev          # http://localhost:5173
```
- `VITE_API_MODE=mock`: everything on the built-in mock API (no backend needed).
- `VITE_API_MODE=hybrid`: **matches the repo today.** Payments come from the real backend (`GET /api/payments/orders/:orderId`); cases, AI and evidence stay mocked because those routes aren't built yet.
- `VITE_API_MODE=live`: everything from the backend. `/api` is proxied to `http://localhost:4000` (see `vite.config.js`).
- No secrets live in the frontend. PayPal and AI keys stay server-side.

## Demo flow
Home → **Report a problem** on an order → choose issue → **Create case** → **Generate AI brief** → add evidence → edit / copy / save the draft.

## What the team repo actually has (checked against `main`)
- Built: payments only (`backend/src/services/payments`, routes `POST /payments/orders`, `POST /payments/orders/:id/capture`, `GET /payments/orders/:id`, `GET /payments/captures/:id`). Responses are `{ payment, transaction, meta }` (camelCase), errors are `{ error: { code, message, retryable, outcome_unknown, debug_id } }`. `src/api/adapters.js` converts this to the UI shape.
- Empty so far: `app.js`, `server.js`, `config/env.js`, all case/merchant routes, and all AI files except `caseAnalyzer.test.js`.
- Khanak's analyzer output (from that test) differs from the plan's AI schema (`issue`, `missing_information`, `recommended_actions`, `human_review`, …). The adapter supports **both**; the analyzer shape has no `draft_message`, so the UI has a "Generate draft message" button that calls `/draft-response`.
- Payments route prefix assumed to be `/api/payments/...` once `app.js` mounts the router at `/api`.

## API used (from section 4.2) and ASSUMPTIONS to confirm
Used as specified: `GET /api/payments/:id`, `POST /api/cases`, `GET /api/cases/:id`, `POST /api/cases/:id/analyze`, `POST /api/cases/:id/draft-response`, `POST /api/cases/:id/actions`.

**Not in the contract yet. Needs agreement before integration:**
1. `GET /api/payments`: list the buyer's orders (Kavya). Until it exists, the live home page uses an "order ID lookup" box.
2. `GET /api/cases`: list the buyer's own cases (Kashish/Khanak).
3. `POST /api/cases/:id/evidence`: add evidence metadata `{ type, description }` (Kashish).
4. `GET /api/cases/:id` response shape expected:
   `{ case, payment, evidence[], timeline[{id,label,timestamp,source_mode}], recommendation|null, audit[] }`
5. `recommendation` fields: `summary, verified_facts[{statement, source_field, source_mode}], unknowns[], evidence_gaps[], suggested_next_step, draft_message, caution, confidence_label, model_version, is_fallback`.
6. Saving the buyer draft uses `POST /api/cases/:id/actions` with `action_type: "save_buyer_draft"`, an `idempotency_key`, and `payload.draft_message`; `case.saved_buyer_draft` is read back.
7. `POST /api/cases/:id/draft-response` returns `{ draft_message }`.

Enums (`issue_type`, `status`, `source_mode`) live in `src/constants.js`, matching section 7.

## Guardrails followed
- Client sends only a payment *reference*; amount/status are never sent or trusted from the browser.
- UI renders structured AI fields; it never parses free-form prose.
- User-provided evidence is always labelled **unverified** unless the API says `verified_at`.
- Synthetic data is visibly labelled; a boundary banner is always shown.

## Known limitations
- No auth screens; assumes the backend identifies the buyer (cookie/session).
- Evidence is metadata only (no file upload), per MVP.
- No automated tests yet for the frontend.
