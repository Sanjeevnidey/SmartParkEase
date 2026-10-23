const crypto = require('crypto');
const { Booking, BookingSegment } = require('../models');
const { nowInZone } = require('./time');

// Crockford base32 without I, L, O, U: 32^6 = about 1 billion references per day.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function newReference(date) {
  const bytes = crypto.randomBytes(6);
  const suffix = Array.from(bytes, b => ALPHABET[b % 32]).join('');
  return `PK-${date.replace(/-/g, '').slice(2)}-${suffix}`;
}

function vehicleKey(plate) {
  return String(plate).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// A booking has started once its date is before today, or it is today and its start hour has begun.
function hasStarted(booking, now = nowInZone()) {
  return booking.date < now.date || (booking.date === now.date && booking.startHour <= now.hour);
}

// Bookings whose end time has passed become Completed. This runs before bookings are read,
// so status is always correct without a scheduled job (which would need extra cloud resources).
async function completePastBookings(now = nowInZone()) {
  const result = await Booking.updateMany(
    { status: 'Confirmed', $or: [{ date: { $lt: now.date } }, { date: now.date, endHour: { $lte: now.hour } }] },
    { $set: { status: 'Completed' } }
  );
  return result.modifiedCount;
}

// Occupied spot count per lot for one date and hour, from the segments collection.
async function occupiedByLot(date, hour) {
  const rows = await BookingSegment.aggregate([
    { $match: { date, hour } },
    { $group: { _id: '$lotId', occupied: { $sum: 1 } } }
  ]);
  return new Map(rows.map(r => [String(r._id), r.occupied]));
}

module.exports = { newReference, vehicleKey, hasStarted, completePastBookings, occupiedByLot };
