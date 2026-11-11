'use strict';

require('dotenv').config();

const bool = (v, fallback = false) => (v === undefined || v === '' ? fallback : String(v).toLowerCase() === 'true');
const int = (v, fallback) => (Number.isFinite(Number.parseInt(v, 10)) ? Number.parseInt(v, 10) : fallback);

/**
 * Validates the environment once at startup. PayPal-specific values are parsed again (and
 * sandbox-checked) by config/paypal.config.js; here we only check they are *present*.
 * Missing PayPal/AI keys are a warning in dev (so the merchant side can run alone) and an error in production.
 */
function loadEnv(env = process.env) {
  const problems = [];
  const warnings = [];
  const isProd = env.NODE_ENV === 'production';

  const databaseUrl = env.DATABASE_URL || 'sqlite:./data/resolve.db';
  if (/^postgres(ql)?:/i.test(databaseUrl)) {
    problems.push('DATABASE_URL points at PostgreSQL, but this build only ships the SQLite adapter (use sqlite:./data/resolve.db).');
  }

  for (const key of ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'AI_API_KEY']) {
    if (!env[key]) (isProd ? problems : warnings).push(`${key} is not set`);
  }

  const demoMode = bool(env.DEMO_MODE, false);
  if (isProd && demoMode) problems.push('DEMO_MODE=true must not be used with NODE_ENV=production (header-based demo auth is not secure).');

  if (problems.length) throw new Error(`Invalid environment:\n - ${problems.join('\n - ')}`);

  return Object.freeze({
    nodeEnv: env.NODE_ENV || 'development',
    port: int(env.PORT, 4000),
    demoMode,
    databaseFile: databaseUrl.replace(/^sqlite:(\/\/)?/i, ''),
    corsOrigin: env.CORS_ORIGIN || 'http://localhost:5173',
    warnings,
  });
}

module.exports = { loadEnv };
