'use strict';

function createUsersRepo(db) {
  const byId = db.prepare('SELECT id, role, display_name, merchant_label, source_mode FROM users WHERE id = ?');
  return {
    findById: (id) => byId.get(id) || null,
    insert: (u) =>
      db.prepare('INSERT INTO users (id, role, display_name, merchant_label, source_mode, created_at) VALUES (@id, @role, @display_name, @merchant_label, @source_mode, @created_at)').run({
        merchant_label: null,
        source_mode: 'synthetic_demo',
        created_at: new Date().toISOString(),
        ...u,
      }),
  };
}

module.exports = { createUsersRepo };
