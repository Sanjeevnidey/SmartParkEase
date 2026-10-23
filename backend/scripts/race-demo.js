// Experiment for the report: N clients try to book the same spot and hour at the same moment.
//   naive   - "check if free, then insert" with no constraint (a common bug)
//   parkease - the real design: unique index on (lotId, date, slot, hour) + transaction
// Usage: MONGODB_URI=... node scripts/race-demo.js [clients=50] [rounds=20]
// Uses its own database (parkease_race_demo) and drops it afterwards.
require('dotenv').config();
const mongoose = require('mongoose');

const clients = Number(process.argv[2] || 50), rounds = Number(process.argv[3] || 20);

async function run() {
  const conn = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: 'parkease_race_demo', maxPoolSize: 60 }).asPromise();
  const db = conn.db;
  await db.dropDatabase();
  const naive = db.collection('naive_segments');
  const safe = db.collection('safe_segments');
  const safeBookings = db.collection('safe_bookings');
  await safe.createIndex({ lotId: 1, date: 1, slot: 1, hour: 1 }, { unique: true });

  const result = { clients, rounds, naive: { roundsWithDoubleBooking: 0, maxWinners: 0, totalWinners: 0 }, parkease: { roundsWithDoubleBooking: 0, maxWinners: 0, totalWinners: 0 } };
  for (let r = 0; r < rounds; r++) {
    const key = { lotId: 'L1', date: `2026-01-${String(r + 1).padStart(2, '0')}`, slot: 'A-01', hour: 10 };
    // Naive: read, then write if nothing was found.
    const naiveWins = await Promise.all(Array.from({ length: clients }, async (_, c) => {
      const taken = await naive.findOne(key);
      if (taken) return 0;
      await naive.insertOne({ ...key, client: c });
      return 1;
    }));
    // ParkEase: booking + segment in one transaction; the unique index rejects all but one.
    const safeWins = await Promise.all(Array.from({ length: clients }, async (_, c) => {
      const session = conn.getClient().startSession();
      try {
        await session.withTransaction(async () => {
          const { insertedId } = await safeBookings.insertOne({ client: c, ...key }, { session });
          await safe.insertOne({ ...key, bookingId: insertedId }, { session });
        });
        return 1;
      } catch (e) { if (e.code === 11000) return 0; throw e; } finally { await session.endSession(); }
    }));
    for (const [name, wins] of [['naive', naiveWins], ['parkease', safeWins]]) {
      const n = wins.reduce((a, b) => a + b, 0);
      result[name].totalWinners += n;
      result[name].maxWinners = Math.max(result[name].maxWinners, n);
      if (n > 1) result[name].roundsWithDoubleBooking++;
    }
  }
  result.parkease.orphanBookings = (await safeBookings.countDocuments()) - (await safe.countDocuments());
  console.log(JSON.stringify(result, null, 2));
  await db.dropDatabase();
  await conn.close();
}
run().catch(err => { console.error(err); process.exit(1); });
