const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { User, ParkingEvent } = require('../models');

class HttpError extends Error {
  constructor(statusCode, message, details) { super(message); this.statusCode = statusCode; this.details = details; }
}

// Wraps an async route so rejected promises reach the error handler (Express 4 does not do this).
const handle = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Parses req[part] with a zod schema and replaces it with the parsed (typed, trimmed) value.
// Unknown keys are stripped, so objects such as { "$ne": "" } never reach a MongoDB query.
function validate(schema, part = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[part] ?? {});
    if (!result.success) {
      const issue = result.error.issues[0];
      return next(new HttpError(400, issue.message === 'Required' ? `${issue.path.join('.') || 'value'} is required.` : issue.message, result.error.issues.map(i => ({ path: i.path.join('.'), message: i.message }))));
    }
    req.valid = { ...(req.valid || {}), [part]: result.data };
    next();
  };
}

function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role }, process.env.JWT_SECRET, { expiresIn: '8h', algorithm: 'HS256' });
}

function auth(requiredRole) {
  return async (req, res, next) => {
    try {
      const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!token) return res.status(401).json({ error: 'Sign in to continue.' });
      const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
      if (!mongoose.isValidObjectId(payload.sub)) return res.status(401).json({ error: 'Your session is invalid or expired.' });
      // Role is read from the database on every request, so demoting an admin takes effect immediately.
      const user = await User.findById(payload.sub).select('-passwordHash');
      if (!user) return res.status(401).json({ error: 'Account not found.' });
      if (requiredRole && user.role !== requiredRole) return res.status(403).json({ error: 'Administrator access required.' });
      req.user = user; next();
    } catch (e) {
      if (e.name === 'JsonWebTokenError' || e.name === 'TokenExpiredError' || e.name === 'NotBeforeError') return res.status(401).json({ error: 'Your session is invalid or expired.' });
      next(e);
    }
  };
}

function audit(actorId, action, entityType, entityId, details = {}) {
  return ParkingEvent.create({ actorId, action, entityType, entityId: String(entityId || ''), details }).catch(err => console.error('Audit event failed:', err.message));
}

function publicUser(user) {
  return { id: user._id, name: user.name, email: user.email, role: user.role };
}

module.exports = { HttpError, handle, validate, signToken, auth, audit, publicUser };
