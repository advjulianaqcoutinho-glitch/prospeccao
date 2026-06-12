'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');

const SKIP_PREFIXES = ['/api/auth/login', '/api/webhooks/'];

function authMiddleware(req, res, next) {
  const path = req.path || req.url;

  const skip = SKIP_PREFIXES.some((prefix) => path.startsWith(prefix));
  if (skip) return next();

  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, config.JWT_SECRET);
    req.user = payload;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = authMiddleware;
