'use strict';

const express = require('express');
const { registerPaymentRoutes } = require('./payments.routes');

const router = express.Router();

// POST /payments/orders, POST /payments/orders/:id/capture, GET /payments/orders/:id, GET /payments/captures/:id
router.use('/payments', registerPaymentRoutes(express.Router()));

module.exports = router;
