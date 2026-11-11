'use strict';

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'migrations');

/** Applies every NNN_name.sql file that has not run yet, each inside its own transaction. */
function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set(db.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name));
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
  const applied = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(DIR, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(file, new Date().toISOString());
    })();
    applied.push(file);
  }
  return applied;
}

module.exports = { migrate };

if (require.main === module) {
  const { loadEnv } = require('../config/env');
  const { openDatabase } = require('./index');
  const cfg = loadEnv();
  const db = openDatabase(cfg.databaseFile);
  console.log(`Database ready at ${cfg.databaseFile}`);
  db.close();
}
