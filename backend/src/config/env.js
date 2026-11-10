'use strict';

/**
 * Loads backend/.env (if present) into process.env, then exposes app-level settings.
 * Uses Node's built-in loader (Node >= 20.12), so no dotenv dependency.
 * Real environment variables always win over .env values.
 * PayPal settings live in paypal.config.js and are read from process.env too.
 */
const path = require('path');

try {
  process.loadEnvFile(path.resolve(__dirname, '../../.env'));
} catch (err) {
  if (err.code !== 'ENOENT') throw err; // a missing .env is fine; a broken one is not
}

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number.parseInt(process.env.PORT, 10) || 4000,
};
