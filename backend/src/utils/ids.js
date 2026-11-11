'use strict';
const crypto = require('crypto');

/** newId('case') -> 'case_3f9a1c2b7d40' (short and URL-safe; never treat an ID as a secret, always check ownership). */
const newId = (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

const ID_RE = /^[A-Za-z0-9_-]{3,64}$/;
const isValidId = (v) => typeof v === 'string' && ID_RE.test(v);

module.exports = { newId, isValidId, ID_RE };
