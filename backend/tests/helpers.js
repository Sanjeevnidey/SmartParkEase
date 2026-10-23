// Test setup: a real MongoDB replica set is required (transactions). Start one with
//   docker run -d --name parkease-mongo -p 27017:27017 mongo:7 --replSet rs0
//   docker exec parkease-mongo mongosh --eval 'rs.initiate()'
// and set MONGODB_URI_TEST (default mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-'.padEnd(48, 'x');
process.env.CLIENT_ORIGIN = 'http://localhost:5173,https://parkease.example.com';
process.env.APP_TIMEZONE = process.env.APP_TIMEZONE || 'UTC';

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const models = require('../src/models');
const { signToken } = require('../src/lib/http');
const { nowInZone, addDays } = require('../src/lib/time');

const BASE_URI = process.env.MONGODB_URI_TEST || 'mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true';

async function connect(dbName) {
  await mongoose.connect(BASE_URI, { dbName, serverSelectionTimeoutMS: 5000 });
  await mongoose.connection.dropDatabase();
  // Build unique indexes before any test writes; they are what makes double booking impossible.
  for (const Model of [models.User, models.ParkingLot, models.Booking, models.BookingSegment, models.ParkingEvent]) {
    await Model.createCollection();
    await Model.createIndexes();
  }
}

async function disconnect() {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}

async function makeUser(role = 'customer', name = 'Test User') {
  const email = `${role}-${new mongoose.Types.ObjectId()}@test.local`;
  const user = await models.User.create({ name, email, role, passwordHash: await bcrypt.hash('password123', 4) });
  return { user, token: signToken(user), email, password: 'password123' };
}

async function makeLot(overrides = {}) {
  return models.ParkingLot.create({ name: `Lot ${new mongoose.Types.ObjectId()}`, area: 'Downtown', address: '1 Test Street', type: 'Mall', price: 40, total: 20, available: 20, ...overrides });
}

const today = () => nowInZone().date;
const tomorrow = () => addDays(today(), 1);
const bearer = token => ({ Authorization: `Bearer ${token}` });

module.exports = { connect, disconnect, makeUser, makeLot, today, tomorrow, bearer, request, models, mongoose };
