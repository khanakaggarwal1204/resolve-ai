'use strict';
const { unauthenticated, AppError } = require('../utils/errors');
const { isValidId } = require('../utils/ids');

/**
 * DEMO authentication. The browser sends `X-Demo-User: <user id>` (picked in the UI's demo user switcher)
 * and we look the user up in the database. This proves nothing about the caller, so it is only enabled
 * when DEMO_MODE=true (env.js refuses DEMO_MODE with NODE_ENV=production).
 * Role and ownership are then enforced server-side on every route: requireRole + ownership-scoped queries.
 */
function createAuth({ models, demoMode }) {
  return function auth(req, res, next) {
    if (!demoMode) {
      return next(new AppError('AUTH_NOT_CONFIGURED', 'No authentication provider is configured. Set DEMO_MODE=true for the hackathon demo.', { httpStatus: 401 }));
    }
    const id = req.get('X-Demo-User');
    if (!id) return next(unauthenticated('Choose a demo user to continue.'));
    const user = isValidId(id) ? models.users.findById(id) : null;
    if (!user) return next(unauthenticated('Unknown user.'));
    req.user = { id: user.id, role: user.role, displayName: user.display_name };
    next();
  };
}

module.exports = { createAuth };
