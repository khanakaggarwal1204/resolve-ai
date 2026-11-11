'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { migrate } = require('./migrate');

/** Open (and migrate) a SQLite database. Use ':memory:' in tests. */
function openDatabase(filename = ':memory:') {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  const db = new Database(filename);
  if (filename !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

module.exports = { openDatabase };
