// Experiment for the report: the availability query with and without an index.
// Fills a scratch database (parkease_index_demo) with synthetic booking segments, runs
// the same query with a forced collection scan and with the lot_date_hour index, and
// prints MongoDB's own executionStats. The scratch database is dropped afterwards.
// Usage: MONGODB_URI=... node scripts/index-benchmark.js [segments=200000]
require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
  const total = Number(process.argv[2] || 200000);
  const conn = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: 'parkease_index_demo' }).asPromise();
  const col = conn.db.collection('bookingsegments');
  await conn.db.dropDatabase();
  const lots = Array.from({ length: 20 }, () => new mongoose.Types.ObjectId());
  const batch = [];
  let seed = 42;
  const rand = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return Math.floor(seed / 65536) % n; }; // deterministic LCG, high bits
  for (let i = 0; i < total; i++) {
    const day = rand(90);
    batch.push({ lotId: lots[rand(20)], date: `2026-${String(1 + Math.floor(day / 30)).padStart(2, '0')}-${String(1 + (day % 30)).padStart(2, '0')}`, slot: `S-${rand(50)}`, hour: rand(24), bookingId: new mongoose.Types.ObjectId() });
    if (batch.length === 10000) await col.insertMany(batch.splice(0));
  }
  if (batch.length) await col.insertMany(batch);
  await col.createIndex({ lotId: 1, date: 1, hour: 1 }, { name: 'lot_date_hour' });
  const query = { lotId: lots[3], date: '2026-02-10', hour: { $gte: 9, $lt: 12 } };
  const measure = async hint => {
    const runs = [];
    let stats;
    for (let i = 0; i < 5; i++) {
      const plan = await col.find(query).hint(hint).explain('executionStats');
      stats = plan.executionStats; runs.push(stats.executionTimeMillis);
    }
    return { nReturned: stats.nReturned, totalKeysExamined: stats.totalKeysExamined, totalDocsExamined: stats.totalDocsExamined, medianTimeMs: runs.sort((a, b) => a - b)[2] };
  };
  console.log(JSON.stringify({ segments: total, query: { ...query, lotId: 'one of 20 lots' }, collectionScan: await measure({ $natural: 1 }), indexScan: await measure('lot_date_hour') }, null, 2));
  await conn.db.dropDatabase();
  await conn.close();
}
run().catch(err => { console.error(err); process.exit(1); });
