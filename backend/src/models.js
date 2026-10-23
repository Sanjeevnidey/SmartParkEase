const mongoose = require('mongoose');
const { Schema } = mongoose;

const LOT_TYPES = ['Mall', 'Office', 'Transit', 'Hospital', 'Event'];
const BOOKING_STATUSES = ['Confirmed', 'Completed', 'Cancelled'];

const userSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['customer', 'admin'], default: 'customer' }
}, { timestamps: true });

const parkingLotSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 }, area: { type: String, required: true, trim: true, maxlength: 80 },
  address: { type: String, required: true, trim: true, maxlength: 200 }, type: { type: String, enum: LOT_TYPES, default: 'Mall' },
  price: { type: Number, required: true, min: 0 }, total: { type: Number, required: true, min: 1, max: 500 },
  // Kept for backward compatibility with old clients. The API now returns live availability
  // computed from bookingsegments instead of trusting this stored number.
  available: { type: Number, min: 0 }, rating: { type: Number, default: 4.5, min: 0, max: 5 },
  features: { type: [String], default: [] }, active: { type: Boolean, default: true }
}, { timestamps: true });
parkingLotSchema.index({ area: 1, active: 1 });
parkingLotSchema.index({ name: 'text', address: 'text', area: 'text' });

const bookingSchema = new Schema({
  reference: { type: String, required: true, unique: true }, userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  lotId: { type: Schema.Types.ObjectId, ref: 'ParkingLot', required: true },
  lotName: { type: String, required: true }, slot: { type: String, required: true }, date: { type: String, required: true },
  start: { type: String, required: true }, end: { type: String, required: true },
  startHour: { type: Number, required: true, min: 0, max: 23 }, endHour: { type: Number, required: true, min: 1, max: 24 },
  amount: { type: Number, required: true, min: 0 },
  vehicle: { type: String, default: 'Sedan', maxlength: 20 }, plate: { type: String, required: true, maxlength: 15 },
  status: { type: String, enum: BOOKING_STATUSES, default: 'Confirmed' },
  cancelledAt: Date
}, { timestamps: true });
bookingSchema.index({ userId: 1, createdAt: -1 });
bookingSchema.index({ lotId: 1, date: 1, status: 1 });
bookingSchema.index({ status: 1, date: 1 });
bookingSchema.path('endHour').validate(function (v) { return v > this.startHour; }, 'endHour must be after startHour');

// One document per occupied (spot, hour). Two unique indexes turn "no overlapping bookings"
// into a database constraint that holds under concurrency, because every segment of a
// booking is inserted in the same multi-document transaction as the booking itself:
//   1. (lotId, date, slot, hour)  - a spot cannot be reserved twice for the same hour.
//   2. (vehicleKey, date, hour)   - one vehicle cannot hold two spots at the same time.
const segmentSchema = new Schema({
  lotId: { type: Schema.Types.ObjectId, ref: 'ParkingLot', required: true }, date: { type: String, required: true },
  slot: { type: String, required: true }, hour: { type: Number, required: true, min: 0, max: 23 },
  vehicleKey: { type: String, required: true },
  bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true }
}, { timestamps: true });
segmentSchema.index({ lotId: 1, date: 1, slot: 1, hour: 1 }, { unique: true, name: 'uniq_spot_hour' });
// Partial so that segments written before vehicleKey existed do not block the index build.
segmentSchema.index({ vehicleKey: 1, date: 1, hour: 1 }, { unique: true, name: 'uniq_vehicle_hour', partialFilterExpression: { vehicleKey: { $type: 'string' } } });
segmentSchema.index({ lotId: 1, date: 1, hour: 1 }, { name: 'lot_date_hour' });
segmentSchema.index({ bookingId: 1 });

const eventSchema = new Schema({ actorId: { type: Schema.Types.ObjectId, ref: 'User' }, action: { type: String, required: true }, entityType: String, entityId: String, details: Schema.Types.Mixed }, { timestamps: true });
eventSchema.index({ createdAt: -1 });

module.exports = {
  LOT_TYPES, BOOKING_STATUSES,
  User: mongoose.models.User || mongoose.model('User', userSchema),
  ParkingLot: mongoose.models.ParkingLot || mongoose.model('ParkingLot', parkingLotSchema),
  Booking: mongoose.models.Booking || mongoose.model('Booking', bookingSchema),
  BookingSegment: mongoose.models.BookingSegment || mongoose.model('BookingSegment', segmentSchema),
  ParkingEvent: mongoose.models.ParkingEvent || mongoose.model('ParkingEvent', eventSchema)
};
