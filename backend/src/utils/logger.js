'use strict';
const { redact } = require('./redact');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

/** Tiny JSON-lines logger. Everything passes through redact(), so secrets never reach the log. */
function createLogger({ level = process.env.LOG_LEVEL || 'info', sink = console } = {}) {
  const min = LEVELS[level] ?? LEVELS.info;
  const emit = (lvl, msg, fields) => {
    if (LEVELS[lvl] < min) return;
    const line = JSON.stringify({ level: lvl, time: new Date().toISOString(), msg, ...redact(fields || {}) });
    (lvl === 'error' ? sink.error : sink.log)(line);
  };
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
  };
}

module.exports = { createLogger };
