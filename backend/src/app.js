const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const { HttpError } = require('./lib/http');
const { modelInfo } = require('./ml/predictor');

const app = express();
app.disable('x-powered-by');
// Render and API Gateway sit in front of the app; trust one proxy hop so rate limits see the client IP.
app.set('trust proxy', 1);
app.use(helmet());

// Only the configured frontends may call the API from a browser. Requests from other origins get
// no CORS headers, so the browser blocks them. Requests without an Origin (curl, health checks) pass.
const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({ origin: (origin, cb) => cb(null, !origin || allowedOrigins.includes(origin)), methods: ['GET', 'POST', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'], maxAge: 600 }));
app.use(express.json({ limit: '20kb' }));

// In-memory limits are per server instance (per Lambda container on AWS). API Gateway stage
// throttling is the account-wide backstop; see docs/AWS_DEPLOYMENT.md.
const limiter = (windowMs, limit, message) => rateLimit({ windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: message } });
const disabled = process.env.RATE_LIMIT === 'off';
const pass = (_req, _res, next) => next();
app.use('/api', disabled ? pass : limiter(15 * 60 * 1000, 600, 'Too many requests. Please slow down.'));
app.use(['/api/auth/login', '/api/auth/register'], disabled ? pass : limiter(15 * 60 * 1000, 20, 'Too many sign-in attempts. Try again in 15 minutes.'));
app.use('/api/predictions', disabled ? pass : limiter(60 * 1000, 60, 'Too many prediction requests. Try again in a minute.'));

app.get('/api/health', async (_req, res) => {
  let database = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  if (database === 'connected') {
    try { await mongoose.connection.db.admin().ping(); } catch { database = 'unreachable'; }
  }
  let model = 'missing';
  try { model = modelInfo().version; } catch { /* reported as missing */ }
  const ok = database === 'connected' && model !== 'missing';
  res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'degraded', service: 'ParkEase API', database, model, time: new Date().toISOString() });
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/lots', require('./routes/lots'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/predictions', require('./routes/predictions'));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

app.use((err, _req, res, _next) => {
  if (err instanceof HttpError) return res.status(err.statusCode).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body must be valid JSON.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large.' });
  if (err.name === 'CastError' || err.name === 'ValidationError') return res.status(400).json({ error: 'Invalid request data.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Check the API logs.' });
});

module.exports = app;
