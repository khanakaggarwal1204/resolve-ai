'use strict';

const { PaymentError, fromPayPalResponse } = require('./paypalErrors');

const noopLogger = { info() {}, warn() {} };
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function safeJson(text) {
  try { return text ? JSON.parse(text) : {}; } catch { return null; }
}

/**
 * Thin PayPal REST client: sandbox OAuth (cached, single-flight), per-request timeout,
 * bounded retries with backoff, and PayPal-Request-Id support.
 *
 * Retry rules:
 *   GET                         -> retried on timeout / network / 429 / 5xx
 *   POST with a requestId       -> same, re-sending the SAME PayPal-Request-Id (PayPal dedupes)
 *   POST without a requestId    -> never retried
 *   4xx (except 429)            -> never retried, mapped to a PaymentError
 *   401 on an API call          -> token is dropped and the call is retried once with a fresh token
 */
function createPayPalClient({ config, fetchImpl = globalThis.fetch, sleep = defaultSleep, now = Date.now, random = Math.random, logger = noopLogger }) {
  let cached = null; // { token, expiresAt }
  let inflight = null;

  async function timedRequest(url, init) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const res = await fetchImpl(url, { ...init, signal: controller.signal });
      const text = await res.text();
      return { status: res.status, ok: res.ok, text, debugId: (res.headers && res.headers.get && res.headers.get('paypal-debug-id')) || null };
    } catch (cause) {
      if ((cause && cause.name === 'AbortError') || controller.signal.aborted) {
        throw new PaymentError('PAYPAL_TIMEOUT', `PayPal did not respond within ${config.timeoutMs} ms`, { httpStatus: 504, retryable: true, cause });
      }
      throw new PaymentError('PAYPAL_NETWORK_ERROR', 'Could not reach PayPal', { httpStatus: 502, retryable: true, cause });
    } finally {
      clearTimeout(timer);
    }
  }

  async function withRetries(fn, canRetry, onRetryableFailure) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (!(err instanceof PaymentError)) throw err;
        if (err.retryable && onRetryableFailure) onRetryableFailure(err);
        if (err.retryable && canRetry && attempt < config.maxRetries) {
          const delay = Math.min(config.retryBaseDelayMs * 2 ** attempt, 5000) * (0.5 + random() / 2);
          logger.warn(`[paypal] ${err.code}, retry ${attempt + 1}/${config.maxRetries} in ${Math.round(delay)}ms`);
          await sleep(delay);
          continue;
        }
        throw err;
      }
    }
  }

  async function fetchToken() {
    if (!config.clientId || !config.clientSecret) {
      throw new PaymentError('PAYPAL_NOT_CONFIGURED', 'PayPal sandbox credentials are not configured', { httpStatus: 500 });
    }
    const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
    const r = await timedRequest(`${config.baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: 'grant_type=client_credentials',
    });
    const body = safeJson(r.text);
    if (!r.ok) {
      if (r.status === 401) throw new PaymentError('PAYPAL_AUTH_FAILED', 'PayPal rejected the sandbox client credentials', { httpStatus: 502, debugId: r.debugId });
      throw fromPayPalResponse(r.status, body || {}, r.debugId);
    }
    if (!body || !body.access_token) throw new PaymentError('PAYPAL_BAD_RESPONSE', 'PayPal token response was malformed', { httpStatus: 502, debugId: r.debugId });
    cached = { token: body.access_token, expiresAt: now() + (Number(body.expires_in) || 300) * 1000 };
    return cached.token;
  }

  /** Cached token; concurrent callers share one in-flight fetch. */
  async function getAccessToken() {
    if (cached && cached.expiresAt - config.tokenSkewMs > now()) return cached.token;
    if (!inflight) inflight = fetchToken().finally(() => { inflight = null; });
    return inflight;
  }

  function invalidateToken(token) {
    if (cached && cached.token === token) cached = null;
  }

  /** @returns {Promise<{status:number, body:object, debugId:string|null}>} */
  async function request({ method, path, body, requestId, prefer = 'return=representation' }) {
    const isRead = method === 'GET';
    const canRetry = isRead || Boolean(requestId);
    let refreshed = false;
    let maybeProcessed = false; // a state-changing call may have reached PayPal without us seeing the answer
    let sentThisAttempt = false; // false while we are still fetching the token (nothing sent yet)

    try {
      return await withRetries(async () => {
        sentThisAttempt = false;
        for (;;) {
          const token = await getAccessToken();
          const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
          if (!isRead) { headers['Content-Type'] = 'application/json'; headers.Prefer = prefer; }
          if (requestId) headers['PayPal-Request-Id'] = requestId;

          sentThisAttempt = true;
          const r = await timedRequest(`${config.baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });

          if (r.status === 401 && !refreshed) { refreshed = true; invalidateToken(token); continue; }

          const parsed = safeJson(r.text);
          if (!r.ok) throw fromPayPalResponse(r.status, parsed || {}, r.debugId);
          if (parsed === null) throw new PaymentError('PAYPAL_BAD_RESPONSE', 'PayPal returned a non-JSON response', { httpStatus: 502, debugId: r.debugId });
          return { status: r.status, body: parsed, debugId: r.debugId };
        }
      }, canRetry, (err) => { if (sentThisAttempt && err.code !== 'PAYPAL_RATE_LIMITED') maybeProcessed = true; });
    } catch (err) {
      if (err instanceof PaymentError && !isRead && maybeProcessed && err.retryable) err.outcomeUnknown = true;
      throw err;
    }
  }

  return { request, getAccessToken };
}

module.exports = { createPayPalClient };
