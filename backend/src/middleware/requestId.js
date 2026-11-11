'use strict';
const crypto = require('crypto');

/** Attaches req.id (also returned as X-Request-Id and in the response envelope). */
module.exports = function requestId(req, res, next) {
  const incoming = req.get('X-Request-Id');
  req.id = incoming && /^[A-Za-z0-9._-]{8,64}$/.test(incoming) ? incoming : `req_${crypto.randomUUID().slice(0, 12)}`;
  res.setHeader('X-Request-Id', req.id);
  next();
};
