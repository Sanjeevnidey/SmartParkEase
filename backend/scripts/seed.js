// Seeds the six sample parking locations and creates or updates the administrator account.
// Lots are upserted by name, so re-running never deletes lots that existing bookings refer to.
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { User, ParkingLot } = require('../src/models');

const lots = [
  { name: 'Skyline Central Parking', area: 'Downtown', address: '18 Central Avenue, Downtown', type: 'Mall', price: 40, total: 48, rating: 4.8, features: ['CCTV', 'EV charging', 'Covered'] },
  { name: 'Greenway Business Hub', area: 'Tech Park', address: '2 Greenway Road, Tech Park', type: 'Office', price: 30, total: 36, rating: 4.6, features: ['CCTV', 'Security', 'EV charging'] },
  { name: 'Sunset Plaza Garage', area: 'Riverside', address: '75 Riverside Walk, Riverside', type: 'Mall', price: 50, total: 62, rating: 4.9, features: ['Valet', 'Covered', 'Security'] },
  { name: 'MetroLink Park & Ride', area: 'Metro Station', address: '9 Metro Lane, Metro Station', type: 'Transit', price: 20, total: 80, rating: 4.5, features: ['24/7 access', 'CCTV', 'Transit access'] },
  { name: 'Aurora Medical Centre', area: 'North District', address: '12 Aurora Street, North District', type: 'Hospital', price: 25, total: 40, rating: 4.7, features: ['Accessible bays', 'Security', '24/7 access'] },
  { name: 'The Foundry Social', area: 'Arts Quarter', address: '101 Foundry Street, Arts Quarter', type: 'Event', price: 35, total: 52, rating: 4.6, features: ['CCTV', 'Covered', 'Event parking'] }
];

async function run() {
  if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI in backend/.env first.');
  await mongoose.connect(process.env.MONGODB_URI);
  for (const lot of lots) {
    await ParkingLot.updateOne({ name: lot.name }, { $set: { ...lot, active: true }, $setOnInsert: { available: lot.total } }, { upsert: true });
  }
  console.log(`Upserted ${lots.length} parking locations.`);
  const email = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD || '';
  if (email && password.length >= 12) {
    await User.updateOne({ email }, { $set: { name: 'ParkEase Admin', email, passwordHash: await bcrypt.hash(password, 12), role: 'admin' } }, { upsert: true });
    console.log(`Admin account ready: ${email}`);
  } else {
    console.log('No admin created. Set ADMIN_EMAIL and ADMIN_PASSWORD (12+ characters) in .env to create one.');
  }
  await mongoose.disconnect();
}
run().catch(err => { console.error(err); process.exit(1); });
