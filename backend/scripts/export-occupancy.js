// Exports REAL hourly occupancy from MongoDB as a CSV that ml/train.py accepts with --real.
// Every (active lot, date, hour) from the first booking date up to yesterday becomes a row,
// including hours with no bookings, so the model also sees quiet hours.
// Usage: node scripts/export-occupancy.js > ../ml/data/real_occupancy.csv
require('dotenv').config();
const mongoose = require('mongoose');
const { ParkingLot, BookingSegment } = require('../src/models');
const { nowInZone, addDays } = require('../src/lib/time');

const level = rate => (rate >= 0.75 ? 'high' : rate >= 0.4 ? 'medium' : 'low');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const yesterday = addDays(nowInZone().date, -1);
  const [lots, counts] = await Promise.all([
    ParkingLot.find({}).lean(),
    BookingSegment.aggregate([{ $match: { date: { $lte: yesterday } } }, { $group: { _id: { lotId: '$lotId', date: '$date', hour: '$hour' }, occupied: { $sum: 1 } } }])
  ]);
  const byKey = new Map(counts.map(c => [`${c._id.lotId}|${c._id.date}|${c._id.hour}`, c.occupied]));
  const firstDate = counts.reduce((min, c) => (c._id.date < min ? c._id.date : min), yesterday);
  const lines = ['lot_name,lot_type,capacity,price,date,hour,occupied,occupancy_rate,demand,source'];
  for (const lot of lots) {
    for (let date = firstDate; date <= yesterday; date = addDays(date, 1)) {
      for (let hour = 0; hour < 24; hour++) {
        const occupied = byKey.get(`${lot._id}|${date}|${hour}`) || 0;
        const rate = occupied / lot.total;
        lines.push([JSON.stringify(lot.name), lot.type, lot.total, lot.price, date, hour, occupied, rate.toFixed(4), level(rate), 'real'].join(','));
      }
    }
  }
  process.stdout.write(lines.join('\n') + '\n');
  console.error(`Exported ${lines.length - 1} real rows from ${firstDate} to ${yesterday}.`);
  await mongoose.disconnect();
}
run().catch(err => { console.error(err); process.exit(1); });
