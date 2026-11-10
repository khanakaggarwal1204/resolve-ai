'use strict';

const express = require('express');
const { registerPaymentRoutes } = require('./payments.routes');

const router = express.Router();
const payments = registerPaymentRoutes(express.Router());

// POST /orders, POST /orders/:id/capture, GET /orders/:id, GET /captures/:id
// Served under both prefixes: /api/paypal/... (documented API) and /api/payments/... (existing).
router.use('/paypal', payments);
router.use('/payments', payments);

module.exports = router;
