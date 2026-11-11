'use strict';
const { forbidden, unauthenticated } = require('../utils/errors');

/** requireRole('merchant') -> 403 for any other signed-in role. Use after auth. */
module.exports = function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(unauthenticated());
    if (!roles.includes(req.user.role)) return next(forbidden('This area is for merchant accounts.'));
    next();
  };
};
