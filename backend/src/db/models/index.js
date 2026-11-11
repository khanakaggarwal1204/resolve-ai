'use strict';

const { createUsersRepo } = require('./users');
const { createPaymentReferencesRepo } = require('./paymentReferences');
const { createCasesRepo } = require('./cases');
const { createEvidenceRepo } = require('./evidence');
const { createRecommendationsRepo } = require('./recommendations');
const { createActionsRepo } = require('./actions');

/** One bundle of repositories per database handle. Services receive this instead of raw SQL. */
function createModels(db) {
  return {
    // Run fn atomically (better-sqlite3 transactions are synchronous).
    __tx: (fn) => db.transaction(fn)(),
    users: createUsersRepo(db),
    payments: createPaymentReferencesRepo(db),
    cases: createCasesRepo(db),
    evidence: createEvidenceRepo(db),
    recommendations: createRecommendationsRepo(db),
    actions: createActionsRepo(db),
  };
}

module.exports = { createModels };
