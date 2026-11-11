'use strict';

// Integration-contract enums (build plan section 7). Keep in sync with frontend/src/constants.js.
const CASE_STATUS = Object.freeze(['draft', 'submitted', 'under_review', 'awaiting_information', 'resolved', 'closed']);
const ISSUE_TYPES = Object.freeze(['not_received', 'duplicate_charge', 'incorrect_amount', 'cancelled_order', 'other']);
const SOURCE_MODES = Object.freeze(['paypal_sandbox_verified', 'app_owned', 'synthetic_demo', 'user_provided_unverified']);
const ROLES = Object.freeze(['buyer', 'merchant']);
const PRIORITIES = Object.freeze(['high', 'normal', 'low']);

module.exports = { CASE_STATUS, ISSUE_TYPES, SOURCE_MODES, ROLES, PRIORITIES };
