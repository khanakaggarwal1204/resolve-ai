'use strict';

const crypto = require('crypto');
const { PaymentError } = require('./paypalErrors');

/** Stable JSON (sorted keys) so the same request always fingerprints the same. */
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

const fingerprint = (value) => crypto.createHash('sha256').update(stable(value)).digest('hex');

/**
 * In-memory idempotency store (swap for Redis/DB if the team adds one).
 *
 *  - same key + same request, finished   -> replay the stored result (no PayPal call)
 *  - same key + same request, in flight  -> share the running promise (no duplicate call)
 *  - same key + DIFFERENT request        -> 422 IDEMPOTENCY_KEY_REUSED
 *  - failures are NOT stored, so a retry after a timeout / "order not approved yet" really retries.
 *
 * This is the fast local layer. The durable layer is the PayPal-Request-Id header the
 * service sends to PayPal, which survives server restarts.
 */
class IdempotencyStore {
  constructor({ ttlMs = 24 * 60 * 60 * 1000, maxEntries = 10000, now = Date.now } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.now = now;
    this.entries = new Map();
  }

  _evict() {
    const t = this.now();
    for (const [k, e] of this.entries) if (e.expiresAt <= t && !e.promise) this.entries.delete(k);
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value);
  }

  async run(key, requestShape, fn) {
    const fp = fingerprint(requestShape);
    const existing = this.entries.get(key);

    if (existing && !existing.promise && existing.expiresAt <= this.now()) this.entries.delete(key);
    else if (existing) {
      if (existing.fingerprint !== fp) {
        throw new PaymentError('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used with a different request.', { httpStatus: 422 });
      }
      if (existing.promise) return { value: await existing.promise, replayed: true };
      return { value: structuredClone(existing.value), replayed: true };
    }

    const promise = Promise.resolve().then(fn);
    this.entries.set(key, { fingerprint: fp, promise, expiresAt: Infinity });
    try {
      const value = await promise;
      this.entries.set(key, { fingerprint: fp, value: structuredClone(value), expiresAt: this.now() + this.ttlMs });
      this._evict();
      return { value, replayed: false };
    } catch (err) {
      this.entries.delete(key);
      throw err;
    }
  }
}

/** Deterministic PayPal-Request-Id (<=108 chars) derived from our own scope + key. */
const deriveRequestId = (scope, key) => crypto.createHash('sha256').update(`${scope}:${key}`).digest('hex');

module.exports = { IdempotencyStore, fingerprint, deriveRequestId };
