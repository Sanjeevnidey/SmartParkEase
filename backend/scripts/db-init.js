// Builds every index declared in src/models.js and adds MongoDB $jsonSchema validators, so
// integrity rules are enforced by the database itself and not only by the API.
// Run once after deploying a new version: npm run db:init
// Applying validators needs the collMod privilege (Atlas "dbAdmin" or "Atlas admin" role);
// if the database user lacks it, indexes are still built and a warning is printed.
require('dotenv').config();
const mongoose = require('mongoose');
const models = require('../src/models');

const validators = {
  bookings: {
    bsonType: 'object',
    required: ['reference', 'userId', 'lotId', 'slot', 'date', 'startHour', 'endHour', 'amount', 'status'],
    properties: {
      reference: { bsonType: 'string', pattern: '^PK-' },
      date: { bsonType: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' },
      startHour: { bsonType: ['int', 'double', 'long'], minimum: 0, maximum: 23 },
      endHour: { bsonType: ['int', 'double', 'long'], minimum: 1, maximum: 24 },
      amount: { bsonType: ['int', 'double', 'long', 'decimal'], minimum: 0 },
      status: { enum: models.BOOKING_STATUSES }
    }
  },
  bookingsegments: {
    bsonType: 'object',
    required: ['lotId', 'date', 'slot', 'hour', 'bookingId'],
    properties: {
      date: { bsonType: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' },
      hour: { bsonType: ['int', 'double', 'long'], minimum: 0, maximum: 23 }
    }
  },
  parkinglots: {
    bsonType: 'object',
    required: ['name', 'area', 'address', 'price', 'total'],
    properties: {
      price: { bsonType: ['int', 'double', 'long', 'decimal'], minimum: 0 },
      total: { bsonType: ['int', 'double', 'long'], minimum: 1, maximum: 500 },
      type: { enum: models.LOT_TYPES }
    }
  }
};

async function run() {
  if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI in backend/.env first.');
  await mongoose.connect(process.env.MONGODB_URI);
  for (const Model of [models.User, models.ParkingLot, models.Booking, models.BookingSegment, models.ParkingEvent]) {
    await Model.createCollection().catch(() => {});
    await Model.createIndexes();
    console.log(`Indexes ready: ${Model.collection.name} -> ${Object.keys(await Model.collection.indexInformation()).join(', ')}`);
  }
  for (const [collection, $jsonSchema] of Object.entries(validators)) {
    try {
      // validationLevel "moderate": existing documents that predate a rule are not rejected on update.
      await mongoose.connection.db.command({ collMod: collection, validator: { $jsonSchema }, validationLevel: 'moderate', validationAction: 'error' });
      console.log(`Validator applied: ${collection}`);
    } catch (err) {
      console.warn(`Could not apply validator to ${collection}: ${err.message}`);
    }
  }
  await mongoose.disconnect();
}
run().catch(err => { console.error(err); process.exit(1); });
