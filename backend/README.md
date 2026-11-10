# Resolve AI backend

Express API. PayPal (sandbox) is called **only** from here; the browser never sees credentials or tokens.

## Setup

1. Create a sandbox app: https://developer.paypal.com -> Apps & Credentials -> Sandbox -> Create App.
2. `cp .env.example .env` and fill in `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` (the Sandbox values).
3. `npm install`
4. `npm run paypal:check` - gets an OAuth token, confirms it is cached, creates a $1.00 test order.
5. `npm run dev` - API on http://localhost:4000 (the Vite dev server proxies `/api` to it).

## How the PayPal auth works

- `src/config/paypal.config.js` reads env vars and refuses a non-sandbox URL unless `PAYPAL_ALLOW_LIVE=true`.
- `src/services/payments/paypalClient.js` does OAuth 2.0 client-credentials (`POST /v1/oauth2/token`),
  caches the token in memory until 60 s before it expires, shares one in-flight token request between
  concurrent callers, and on a 401 drops the token and retries once.
- Timeouts, bounded retries and `PayPal-Request-Id` are handled in the same client.

## Endpoints

Every `/api/paypal/...` route is also served under `/api/payments/...`.

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/payments/orders` | body `{ amount, currency?, description?, referenceId?, merchantLabel? }`, header `Idempotency-Key` required. Returns `{ orderId, approvalUrl, payment, transaction, meta }` (201, or 200 on replay) |
| POST | `/api/paypal/orders/:orderId/capture` | header `Idempotency-Key` optional. See "Capture" below |
| GET | `/api/payments/orders/:orderId` | |
| GET | `/api/payments/captures/:captureId` | |
| GET | `/health` | |

## Tests

`npm test` runs the payments tests with a scripted fetch (no network, no credentials needed).

## Checkout flow (create order)

1. Buyer clicks **Pay with PayPal** (`frontend/src/components/PayWithPayPal.jsx`).
2. Frontend calls `POST /api/payments/orders` with `{ amount: "50.00", currency: "USD" }` and an `Idempotency-Key`.
3. Backend validates the amount/currency, gets a cached OAuth token, and calls PayPal `POST /v2/checkout/orders` (intent `CAPTURE`).
4. PayPal returns the Order ID and an approval link; the backend responds with `orderId` + `approvalUrl`.
5. Frontend redirects the buyer to `approvalUrl` (only `https://*.paypal.com` is allowed). The buyer approves with a sandbox account.

Example:

```bash
curl -X POST http://localhost:4000/api/payments/orders \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: demo-order-0001' \
  -d '{"amount":"50.00","currency":"USD","description":"Sandbox product"}'
```

## Capture flow

1. After the buyer approves, PayPal redirects to `PAYPAL_RETURN_URL?token=<ORDER_ID>&PayerID=...` (`/checkout/return` in the frontend).
2. The page calls `POST /api/paypal/orders/:orderId/capture` once, with a stable `Idempotency-Key` (`capture-<orderId>`).
3. The backend asks PayPal to capture. PayPal itself refuses an order the buyer has not approved (`409 ORDER_NOT_APPROVED`, nothing is charged).
4. The response says what really happened:

| Outcome | HTTP | Meaning |
| --- | --- | --- |
| `captured` (`verified: true`, `captureId` set) | 201 (200 on duplicate) | PayPal confirms the capture is COMPLETED |
| `pending` | 202 | accepted but not final; call again, the backend re-checks PayPal and never captures twice |
| `unknown` | 202 | PayPal did not confirm a capture; do not assume success or failure |
| declined / failed | 402 `PAYMENT_DECLINED` / `PAYMENT_FAILED` | nothing captured |
| not approved | 409 `ORDER_NOT_APPROVED` | buyer has not approved yet |
| timeout / network | 502/504 with `outcome_unknown: true` | the backend first asks PayPal what happened; if it still cannot tell, the error says so |

Duplicate protection (three layers): an in-memory idempotency store, a `PayPal-Request-Id` derived from the key, and `ORDER_ALREADY_CAPTURED` recovery (reports the real state instead of failing).

```bash
curl -X POST http://localhost:4000/api/paypal/orders/<ORDER_ID>/capture -H 'Idempotency-Key: capture-<ORDER_ID>'
```
