'use strict';
const express = require('express');
const cors = require('cors');

const { createModels } = require('./db/models');
const { createAuditService } = require('./services/auditService');
const { createDuplicateService } = require('./services/duplicateService');
const { createMerchantService } = require('./services/merchantService');
const { createMerchantController } = require('./controllers/merchant.controller');
const { createMerchantRouter } = require('./routes/merchant.routes');
const { createHealthRouter } = require('./routes/health.routes');
const { createAuth } = require('./middleware/auth');
const requestId = require('./middleware/requestId');
const { createErrorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { createLogger } = require('./utils/logger');

/**
 * Builds the Express app. Dependencies are injected so tests can use an in-memory database.
 *   mountPayments: false  skips Kavya's PayPal routes (tests run without PayPal credentials).
 *   extraRouters:         [{ path, router }] mounted under /api: Khanak's case routes plug in here.
 */
function createApp({ db, config, logger = createLogger(), mountPayments = true, extraRouters = [] }) {
  const models = createModels(db);
  const audit = createAuditService({ db });
  const duplicates = createDuplicateService({ db });
  const merchantService = createMerchantService({ models, audit, duplicates });
  const auth = createAuth({ models, demoMode: config.demoMode });

  const app = express();
  app.disable('x-powered-by');
  app.use(requestId);
  app.use(cors({ origin: config.corsOrigin, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use((req, res, next) => {
    res.on('finish', () => logger.info('request', { requestId: req.id, method: req.method, path: req.path, status: res.statusCode }));
    next();
  });

  app.use('/api/health', createHealthRouter({ db, config }));
  app.use('/api/merchant', createMerchantRouter({ auth, controller: createMerchantController({ merchantService }) }));
  for (const { path, router } of extraRouters) app.use(`/api${path}`, router);
  if (mountPayments) app.use('/api', require('./routes')); // Kavya's payments router

  app.use('/api', notFoundHandler);
  app.use(createErrorHandler({ logger }));

  return { app, models, audit, services: { merchantService, duplicates } };
}

module.exports = { createApp };
