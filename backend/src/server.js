'use strict';

const { createApp, config } = require('./app');
const { loadPayPalConfig } = require('./config/paypal.config');

const paypal = loadPayPalConfig();
if (!paypal.clientId || !paypal.clientSecret) {
  console.warn('[server] PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are not set. Payment routes will return PAYPAL_NOT_CONFIGURED until you add them to backend/.env');
}

createApp().listen(config.port, () => {
  console.log(`[server] listening on http://localhost:${config.port} (PayPal: ${paypal.environment})`);
});
