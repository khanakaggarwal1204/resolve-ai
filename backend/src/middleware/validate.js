'use strict';

/**
 * validate({ params, query, body }) where each is a parser (input) => value that throws badRequest() on bad input.
 * Parsed values land on req.valid.{params,query,body}; handlers must read from there, never from raw req.body.
 */
module.exports = function validate(parsers) {
  return (req, res, next) => {
    try {
      req.valid = {};
      for (const part of ['params', 'query', 'body']) {
        if (parsers[part]) req.valid[part] = parsers[part](req[part]);
      }
      next();
    } catch (e) { next(e); }
  };
};
