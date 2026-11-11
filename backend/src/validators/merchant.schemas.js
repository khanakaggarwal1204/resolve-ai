'use strict';
const { badRequest } = require('../utils/errors');
const { isValidId } = require('../utils/ids');
const { CASE_STATUS, ISSUE_TYPES, PRIORITIES } = require('../utils/enums');

const MAX_DRAFT = 4000;
const MAX_Q = 80;
const MERCHANT_TARGET_STATUSES = ['under_review', 'awaiting_information', 'resolved', 'closed']; // 'draft'/'submitted' belong to the buyer flow
const KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/; // same rule as the payments Idempotency-Key

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;

function parseIdParam(params) {
  if (!isValidId(params.id)) throw badRequest([{ field: 'id', issue: 'invalid id format' }]);
  return { id: params.id };
}

/** GET /merchant/cases query: status (comma list), priority, issue_type, q, limit, offset. Unknown params are ignored; known ones are strict. */
function parseListQuery(query = {}) {
  const issues = [];
  const out = {};

  if (query.status !== undefined && query.status !== '') {
    const list = String(query.status).split(',').map((s) => s.trim()).filter(Boolean);
    const bad = list.filter((s) => !CASE_STATUS.includes(s) || s === 'draft');
    if (bad.length) issues.push({ field: 'status', issue: `unknown status: ${bad.join(', ')}` });
    else out.status = list;
  }
  if (query.priority !== undefined && query.priority !== '') {
    if (!PRIORITIES.includes(query.priority)) issues.push({ field: 'priority', issue: `must be one of ${PRIORITIES.join(', ')}` });
    else out.priority = query.priority;
  }
  if (query.issue_type !== undefined && query.issue_type !== '') {
    if (!ISSUE_TYPES.includes(query.issue_type)) issues.push({ field: 'issue_type', issue: `must be one of ${ISSUE_TYPES.join(', ')}` });
    else out.issue_type = query.issue_type;
  }
  if (query.q !== undefined && query.q !== '') {
    if (typeof query.q !== 'string' || query.q.length > MAX_Q) issues.push({ field: 'q', issue: `must be text up to ${MAX_Q} chars` });
    else out.q = query.q.trim();
  }
  for (const [field, max, fallback] of [['limit', 100, 50], ['offset', 100000, 0]]) {
    if (query[field] === undefined || query[field] === '') { out[field] = fallback; continue; }
    const n = Number(query[field]);
    if (!Number.isInteger(n) || n < (field === 'limit' ? 1 : 0) || n > max) issues.push({ field, issue: `must be an integer up to ${max}` });
    else out[field] = n;
  }
  if (issues.length) throw badRequest(issues);
  return out;
}

/** PATCH body: { status?, merchant_draft? }. Strict: unknown keys are rejected so nothing else can ever be written. */
function parsePatchBody(body) {
  if (!isPlainObject(body)) throw badRequest([{ field: 'body', issue: 'must be a JSON object' }]);
  const issues = [];
  const allowed = new Set(['status', 'merchant_draft']);
  for (const k of Object.keys(body)) if (!allowed.has(k)) issues.push({ field: k, issue: 'not an editable field' });

  const out = {};
  if (body.status !== undefined) {
    if (!MERCHANT_TARGET_STATUSES.includes(body.status)) issues.push({ field: 'status', issue: `must be one of ${MERCHANT_TARGET_STATUSES.join(', ')}` });
    else out.status = body.status;
  }
  if (body.merchant_draft !== undefined) {
    if (typeof body.merchant_draft !== 'string') issues.push({ field: 'merchant_draft', issue: 'must be text' });
    else if (body.merchant_draft.length > MAX_DRAFT) issues.push({ field: 'merchant_draft', issue: `must be at most ${MAX_DRAFT} characters` });
    else if (CONTROL_RE.test(body.merchant_draft)) issues.push({ field: 'merchant_draft', issue: 'contains unsupported control characters' });
    else out.merchant_draft = body.merchant_draft.replace(/\r\n/g, '\n').trim();
  }
  if (!issues.length && out.status === undefined && out.merchant_draft === undefined) {
    issues.push({ field: 'body', issue: 'provide status and/or merchant_draft' });
  }
  if (issues.length) throw badRequest(issues);
  return out;
}

function parseIdempotencyKey(value) {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string' || !KEY_RE.test(value)) {
    throw badRequest([{ field: 'Idempotency-Key', issue: 'must be 8-128 chars of letters, digits, . _ : -' }]);
  }
  return value;
}

module.exports = { parseIdParam, parseListQuery, parsePatchBody, parseIdempotencyKey, MAX_DRAFT, MERCHANT_TARGET_STATUSES };
