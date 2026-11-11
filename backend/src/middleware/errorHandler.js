'use strict';
const { AppError } = require('../utils/errors');

/** Envelope: { data, error, requestId }. Unknown errors are logged with a stack but never leak details to the client. */
function createErrorHandler({ logger }) {
  // eslint-disable-next-line no-unused-vars
  return function errorHandler(err, req, res, next) {
    if (err instanceof AppError) {
      return res.status(err.httpStatus).json({ data: null, error: { code: err.code, message: err.message, issues: err.issues }, requestId: req.id });
    }
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ data: null, error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON.', issues: [] }, requestId: req.id });
    }
    if (err && err.type === 'entity.too.large') {
      return res.status(413).json({ data: null, error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.', issues: [] }, requestId: req.id });
    }
    logger.error('unhandled_error', { requestId: req.id, path: req.path, message: err && err.message, stack: err && err.stack });
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our side. Please try again.', issues: [] }, requestId: req.id });
  };
}

const notFoundHandler = (req, res) =>
  res.status(404).json({ data: null, error: { code: 'ROUTE_NOT_FOUND', message: 'No such endpoint.', issues: [] }, requestId: req.id });

module.exports = { createErrorHandler, notFoundHandler };
