const mongoose = require('mongoose');

function checkConfig() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not configured');
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must be a random value of at least 32 characters');
}

// One shared connection per process. On Lambda the promise survives between warm invocations,
// so each container connects once instead of once per request.
let connectionPromise;
async function connectDatabase() {
  if (mongoose.connection.readyState === 1) return;
  checkConfig();
  if (!connectionPromise) {
    connectionPromise = mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000, maxPoolSize: 5 })
      .catch(err => { connectionPromise = null; throw err; });
  }
  await connectionPromise;
}

module.exports = { connectDatabase, checkConfig };
