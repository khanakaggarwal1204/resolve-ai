'use strict';
const express = require('express');

/** GET /api/health: readiness only, no secrets. Reports whether the database answers. */
function createHealthRouter({ db, config }) {
  const router = express.Router();
  router.get('/', (req, res) => {
    let database = 'ok';
    try { db.prepare('SELECT 1').get(); } catch { database = 'unavailable'; }
    const status = database === 'ok' ? 'ok' : 'degraded';
    res.status(database === 'ok' ? 200 : 503).json({ data: { status, database, demoMode: Boolean(config.demoMode) }, error: null, requestId: req.id });
  });
  return router;
}

module.exports = { createHealthRouter };
