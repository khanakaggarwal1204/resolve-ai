'use strict';
const http = require('http');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { seedDemo } = require('../src/db/seed');
const { createLogger } = require('../src/utils/logger');

/** Fresh in-memory app + seeded synthetic data + a real HTTP server on a random port. No PayPal, no network. */
async function startTestApp({ demoMode = true, seed = true } = {}) {
  const db = openDatabase(':memory:');
  if (seed) seedDemo(db);
  const built = createApp({ db, config: { demoMode, corsOrigin: 'http://localhost:5173' }, logger: createLogger({ level: 'silent' }), mountPayments: false });
  const server = http.createServer(built.app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(method, path, { user, body, headers = {} } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(user ? { 'X-Demo-User': user } : {}), ...headers },
      body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, headers: res.headers, json, data: json && json.data, error: json && json.error };
  }
  return { db, ...built, call, close: () => new Promise((r) => server.close(() => { db.close(); r(); })) };
}

const MERCHANT = 'user_merchant_demo';
const OTHER_MERCHANT = 'user_merchant_other';
const BUYER = 'user_buyer_alice';

module.exports = { startTestApp, MERCHANT, OTHER_MERCHANT, BUYER };
