'use strict';
const { loadEnv } = require('./config/env');
const { openDatabase } = require('./db');
const { createApp } = require('./app');
const { createLogger } = require('./utils/logger');

const logger = createLogger();
const config = loadEnv();
config.warnings.forEach((w) => logger.warn('config_warning', { warning: w }));

const db = openDatabase(config.databaseFile);
const { app } = createApp({ db, config, logger });

const server = app.listen(config.port, () => {
  logger.info('server_started', { port: config.port, demoMode: config.demoMode, env: config.nodeEnv });
  if (config.demoMode) logger.warn('demo_mode_on', { note: 'Header-based demo auth is enabled. Seeded cases are synthetic, not live PayPal disputes.' });
});

function shutdown(signal) {
  logger.info('shutdown', { signal });
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
