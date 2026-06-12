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

// ─── App factory ──────────────────────────────────────────────────────────────

const app = express();

// ── Global middleware ────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

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
app.use('/api/auth', authRouter);
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
