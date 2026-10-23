const express = require('express');
const bcrypt = require('bcryptjs');
const { User } = require('../models');
const schemas = require('../lib/schemas');
const { handle, validate, signToken, auth, audit, publicUser } = require('../lib/http');

const router = express.Router();
// A fixed hash compared when the email is unknown, so both failure paths take the same time
// and response timing does not reveal which emails are registered.
const DUMMY_HASH = bcrypt.hashSync('parkease-timing-guard', 12);

router.post('/register', validate(schemas.register), handle(async (req, res) => {
  const { name, email, password } = req.valid.body;
  if (await User.exists({ email })) return res.status(409).json({ error: 'An account with that email already exists.' });
  let user;
  try {
    user = await User.create({ name, email, passwordHash: await bcrypt.hash(password, 12) });
  } catch (err) {
    // Two simultaneous sign-ups with one email: the unique index lets only one through.
    if (err.code === 11000) return res.status(409).json({ error: 'An account with that email already exists.' });
    throw err;
  }
  await audit(user._id, 'USER_REGISTERED', 'User', user._id);
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
}));

router.post('/login', validate(schemas.login), handle(async (req, res) => {
  const { email, password } = req.valid.body;
  const user = await User.findOne({ email });
  const ok = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !ok) return res.status(401).json({ error: 'Email or password is incorrect.' });
  await audit(user._id, 'USER_LOGIN', 'User', user._id);
  res.json({ token: signToken(user), user: publicUser(user) });
}));

router.get('/me', auth(), (req, res) => res.json({ user: publicUser(req.user) }));

router.patch('/me', auth(), validate(schemas.updateMe), handle(async (req, res) => {
  const user = await User.findByIdAndUpdate(req.user._id, { name: req.valid.body.name }, { new: true, runValidators: true }).select('-passwordHash');
  await audit(user._id, 'USER_UPDATED', 'User', user._id);
  res.json({ user: publicUser(user) });
}));

module.exports = router;
