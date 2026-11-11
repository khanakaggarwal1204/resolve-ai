'use strict';

/** Error type for everything the app-owned API (cases / merchant) throws on purpose. */
class AppError extends Error {
  constructor(code, message, { httpStatus = 500, issues = [] } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.issues = issues;
  }
}

const badRequest = (issues, message = 'Invalid request') => new AppError('VALIDATION_ERROR', message, { httpStatus: 400, issues });
const unauthenticated = (message = 'Sign in to continue.') => new AppError('UNAUTHENTICATED', message, { httpStatus: 401 });
const forbidden = (message = 'You do not have access to this action.') => new AppError('FORBIDDEN', message, { httpStatus: 403 });
// Wrong owner and "does not exist" look identical on purpose: don't leak which case IDs exist.
const notFound = (what = 'Case') => new AppError('NOT_FOUND', `${what} not found.`, { httpStatus: 404 });
const conflict = (code, message) => new AppError(code, message, { httpStatus: 409 });
const unprocessable = (code, message, issues = []) => new AppError(code, message, { httpStatus: 422, issues });

/** Express 4 does not catch rejected promises; wrap async handlers with this. */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { AppError, badRequest, unauthenticated, forbidden, notFound, conflict, unprocessable, asyncHandler };
