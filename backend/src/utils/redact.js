'use strict';

// Keys whose values must never reach logs or the audit trail.
const SECRET_KEY_RE = /(secret|token|password|passwd|authorization|api[_-]?key|credential|cookie|card|cvv|cvc|ssn|iban|account[_-]?number)/i;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const LONG_DIGITS_RE = /\b(?:\d[ -]?){13,19}\b/g; // card-number-shaped digit runs
const MAX_STRING = 300;
const MAX_DEPTH = 4;

function redactString(s) {
  let out = s.replace(EMAIL_RE, '[email]').replace(LONG_DIGITS_RE, '[number]');
  if (out.length > MAX_STRING) out = `${out.slice(0, MAX_STRING)}…[truncated]`;
  return out;
}

/** Returns a redacted deep copy that is safe to store or log. Never mutates the input. */
function redact(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= MAX_DEPTH) return '[nested]';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEY_RE.test(k) ? '[redacted]' : redact(v, depth + 1);
    return out;
  }
  return '[unsupported]';
}

module.exports = { redact, redactString, SECRET_KEY_RE };
