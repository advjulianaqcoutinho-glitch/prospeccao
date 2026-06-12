'use strict';

const express = require('express');
const cors = require('cors');
const authMiddleware = require('./middleware/auth');

// ─── Routers ──────────────────────────────────────────────────────────────────
const authRouter = require('./routes/auth');
const statsRouter = require('./routes/stats');
const campanhasRouter = require('./routes/campanhas');
const leadsRouter = require('./routes/leads');
const tagsRouter = require('./routes/tags');
const whatsappRouter = require('./routes/whatsapp');
const blacklistRouter = require('./routes/blacklist');
const webhooksRouter = require('./routes/webhooks');
const integrationsRouter = require('./routes/integrations');
const queueRouter = require('./routes/queue');
const followupsRouter = require('./routes/followups');
const templatesRouter = require('./routes/templates');
const respostasRouter = require('./routes/respostas');
const analyticsRouter = require('./routes/analytics');
const importRouter = require('./routes/import');
const scoringRouter = require('./routes/scoring');

// ─── App factory ──────────────────────────────────────────────────────────────

const app = express();

// ── Global middleware ────────────────────────────────────────────────────────
// CORS: allow the production domain and localhost for development
const allowedOrigins = [
  'https://prospect.igorpachecoads.com.br',
  'http://localhost:3000',
  'http://localhost:8080',
];
app.use(cors({
  origin: (origin, cb) => {
    // Allow server-to-server requests (no origin) and allowed origins
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

app.use(express.json({ limit: '2mb' }));

// ── Rate limiting (simple in-memory, no extra package needed) ────────────────
const loginAttempts = new Map();
function loginRateLimit(req, res, next) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const window = 15 * 60 * 1000; // 15 minutes
  const maxAttempts = 10;

  const entry = loginAttempts.get(ip) || { count: 0, firstAttempt: now };
  if (now - entry.firstAttempt > window) {
    // Reset window
    loginAttempts.set(ip, { count: 1, firstAttempt: now });
    return next();
  }
  entry.count++;
  loginAttempts.set(ip, entry);

  if (entry.count > maxAttempts) {
    const retry = Math.ceil((window - (now - entry.firstAttempt)) / 1000 / 60);
    return res.status(429).json({ error: `Muitas tentativas. Tente novamente em ${retry} minutos.` });
  }
  return next();
}
// Clean up old entries every hour
setInterval(() => {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [ip, entry] of loginAttempts) {
    if (entry.firstAttempt < cutoff) loginAttempts.delete(ip);
  }
}, 60 * 60 * 1000);

// ── Health check (no auth) ───────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true }));

// ── Auth middleware on /api/* except /api/auth/* and /api/webhooks/* ─────────
app.use('/api', (req, res, next) => {
  const path = req.path;
  if (path.startsWith('/auth/') || path === '/auth' || path.startsWith('/webhooks/') || path === '/webhooks') {
    return next();
  }
  return authMiddleware(req, res, next);
});

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth', loginRateLimit, authRouter);
app.use('/api/stats', statsRouter);
app.use('/api/campanhas', campanhasRouter);
app.use('/api/leads', leadsRouter);
app.use('/api/tags', tagsRouter);
app.use('/api/whatsapp', whatsappRouter);
app.use('/api/blacklist', blacklistRouter);
app.use('/api/webhooks', webhooksRouter);
app.use('/api/integrations', integrationsRouter);
app.use('/api/queue', queueRouter);
// Nested followup routes live under /api/campanhas/:campanhaId/followups
app.use('/api/campanhas', followupsRouter);
app.use('/api/templates', templatesRouter);
app.use('/api/respostas', respostasRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/import', importRouter);
app.use('/api/scoring', scoringRouter);

// ── Global error handler ─────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[app] Unhandled error:', err.message || err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: err.message || 'Internal Server Error',
  });
});

module.exports = app;
