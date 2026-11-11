# PayPal Resolve: backend

Sandbox-only hackathon MVP. **Not** PayPal's Resolution Center. Seeded cases are synthetic, not live disputes, and nothing here issues refunds.

## Run it

```bash
cd backend
npm install
cp .env.example .env          # set DEMO_MODE=true; add PayPal sandbox creds for the payments routes
npm run db:seed               # creates data/resolve.db with SYNTHETIC demo data (needs DEMO_MODE=true)
npm run dev                   # http://localhost:4000  (frontend proxies /api here)
npm test                      # merchant / audit / duplicate-hint tests (no network, in-memory DB)
npm run test:payments         # Kavya's payment tests
npm run db:reset              # delete the local DB for a clean re-seed
```

## Persistence, merchant portal & audit (Kashish)

| Area | Where |
|---|---|
| Schema + migrations | `src/db/migrations/001_init.sql`, runner `src/db/migrate.js` |
| Repositories (used by other services) | `src/db/models/*` (`createModels(db)`) |
| Seed (synthetic, labelled `synthetic_demo`) | `src/db/seed.js` |
| Audit trail (append-only, redacted) | `src/services/auditService.js`, `src/utils/redact.js` |
| Duplicate hints (probabilistic) | `src/services/duplicateService.js` |
| Merchant inbox / review / actions | `src/services/merchantService.js`, `routes/merchant.routes.js` |
| Role + ownership | `src/middleware/auth.js`, `requireRole.js` (ownership is part of every query) |

### Merchant API (envelope `{ data, error, requestId }`)

| Method | Endpoint | Notes |
|---|---|---|
| GET | `/api/merchant/cases?status=&priority=&issue_type=&q=&limit=&offset=` | `status` accepts a comma list. Buyer drafts are never listed. |
| GET | `/api/merchant/cases/:id` | Case, payment, evidence, evidence gaps, timeline, AI brief, duplicate hints, audit. |
| PATCH | `/api/merchant/cases/:id` | Body `{ status?, merchant_draft? }`, header `Idempotency-Key` (optional). Strict: other fields are rejected. |

Allowed merchant transitions: `submitted → under_review | awaiting_information | closed`, `under_review ↔ awaiting_information`, either → `resolved | closed`, `resolved → closed`. `awaiting_information` requires a message to the buyer. Closed cases are immutable. All of this changes the **app record only**.

### Demo users (header `X-Demo-User`, only when `DEMO_MODE=true`)

`user_merchant_demo` (Demo Store), `user_merchant_other` (Other Shop, used to show ownership checks), `user_buyer_alice`, `user_buyer_ben`.

```bash
curl -H 'X-Demo-User: user_merchant_demo' localhost:4000/api/merchant/cases
```

### How the other modules plug in

- **Khanak (cases/AI):** use `createModels(db)`: `cases.insert`, `evidence.insert`, `recommendations.insert(caseId, validatedRec)`, `actions.insert`. Mount routers via `createApp({ extraRouters: [{ path: '/cases', router }] })`. Record events with `audit.record({ actorId, eventType, targetId, metadata })`.
- **Kavya (payments):** after fetching and normalizing an order from PayPal, call `models.payments.upsertVerified(payment)`. That is the only path that writes `paypal_sandbox_verified`. Never call it with request-body data.

## Limitations

- Header-based demo auth is not real authentication. `loadEnv` refuses `DEMO_MODE=true` with `NODE_ENV=production`.
- SQLite only. Priority and duplicate hints are computed on read from simple rules.
- Evidence stores metadata, not files.
