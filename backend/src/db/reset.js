'use strict';
// Deletes the local SQLite file so `npm run db:seed` starts clean. Demo/dev only.
const fs = require('fs');
const { loadEnv } = require('../config/env');

const cfg = loadEnv();
if (cfg.nodeEnv === 'production') throw new Error('Refusing to reset a production database.');
for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${cfg.databaseFile}${suffix}`, { force: true });
console.log(`Removed ${cfg.databaseFile}`);
