const express = require('express');
const mongoose = require('mongoose');
const { ParkingLot, Booking, BookingSegment } = require('../models');
const schemas = require('../lib/schemas');
const { HttpError, handle, validate, auth, audit } = require('../lib/http');
const { isValidSlot } = require('../lib/slots');
const { nowInZone, addDays } = require('../lib/time');
const { newReference, vehicleKey, hasStarted, completePastBookings } = require('../lib/bookings');

const router = express.Router();
const MAX_DAYS_AHEAD = 60;

// Maps a duplicate-key error to the constraint that was violated. insertMany reports it as a
// bulk-write error without keyPattern, so the index name in the message is checked too.
function conflictFor(err) {
  const key = err.keyPattern || err.writeErrors?.[0]?.err?.keyPattern || {};
  const message = String(err.message || err.errmsg || '');
  if (key.reference || /index: reference/.test(message)) return 'reference';
  if (key.vehicleKey || /uniq_vehicle_hour/.test(message)) return 'vehicle';
  return 'spot';
}

router.post('/', auth(), validate(schemas.bookingBody), handle(async (req, res) => {
  const { lotId, slot, date, start, end, vehicle, plate } = req.valid.body;
  const startHour = Number(start.slice(0, 2)), endHour = Number(end.slice(0, 2));
  if (startHour > 23 || endHour <= startHour) throw new HttpError(400, 'End must be after start, within the same day.');
  const now = nowInZone();
  if (date < now.date || (date === now.date && startHour < now.hour)) throw new HttpError(400, 'Bookings cannot start in the past.');
  if (date > addDays(now.date, MAX_DAYS_AHEAD)) throw new HttpError(400, `Bookings can be made up to ${MAX_DAYS_AHEAD} days ahead.`);
  const lot = await ParkingLot.findOne({ _id: lotId, active: true });
  if (!lot) throw new HttpError(404, 'Parking location not found.');
  if (!isValidSlot(slot, lot.total)) throw new HttpError(400, `Spot ${slot} does not exist at ${lot.name}.`);

  const key = vehicleKey(plate);
  // A clash on the random reference is astronomically unlikely, but it is retried rather than
  // reported as a spot conflict. Spot and vehicle clashes are never retried.
  for (let attempt = 0; attempt < 3; attempt++) {
    const session = await mongoose.startSession();
    try {
      let created;
      // withTransaction retries on transient errors (e.g. WriteConflict when two requests race).
      // Either the booking and all of its hourly segments commit together, or none of them do.
      await session.withTransaction(async () => {
        const [booking] = await Booking.create([{
          reference: newReference(date), userId: req.user._id, lotId: lot._id, lotName: lot.name, slot, date, start, end,
          startHour, endHour, amount: lot.price * (endHour - startHour), vehicle, plate, status: 'Confirmed'
        }], { session });
        const segments = Array.from({ length: endHour - startHour }, (_, i) => ({ lotId: lot._id, date, slot, hour: startHour + i, vehicleKey: key, bookingId: booking._id }));
        await BookingSegment.insertMany(segments, { session, ordered: true });
        created = booking;
      });
      await audit(req.user._id, 'BOOKING_CONFIRMED', 'Booking', created._id, { lotId: lot._id, slot, date, start, end });
      return res.status(201).json({ booking: created });
    } catch (err) {
      if (err.code === 11000) {
        const which = conflictFor(err);
        if (which === 'reference') continue;
        if (which === 'vehicle') throw new HttpError(409, `Vehicle ${plate} already has a booking during part of this time.`);
        throw new HttpError(409, 'That parking spot is already reserved for part of this time. Choose another spot or time.');
      }
      throw err;
    } finally {
      await session.endSession();
    }
  }
  throw new HttpError(503, 'Could not create a booking reference. Please try again.');
}));

router.get('/mine', auth(), handle(async (req, res) => {
  await completePastBookings();
  const bookings = await Booking.find({ userId: req.user._id }).sort({ date: -1, startHour: -1 }).limit(200).lean();
  res.json({ bookings });
}));

// Customers can cancel their own bookings; administrators can cancel any booking.
// Only bookings that have not started yet can be cancelled.
router.post('/:id/cancel', auth(), validate(schemas.idParam, 'params'), handle(async (req, res) => {
  const session = await mongoose.startSession();
  let booking;
  try {
    await session.withTransaction(async () => {
      const filter = { _id: req.valid.params.id };
      if (req.user.role !== 'admin') filter.userId = req.user._id;
      booking = await Booking.findOne(filter).session(session);
      if (!booking) throw new HttpError(404, 'Booking not found.');
      if (booking.status !== 'Confirmed') throw new HttpError(409, 'Only confirmed bookings can be cancelled.');
      if (hasStarted(booking)) throw new HttpError(409, 'This booking has already started and can no longer be cancelled.');
      // updateOne (not save) so bookings created before newer validation rules can still be cancelled.
      const cancelledAt = new Date();
      await Booking.updateOne({ _id: booking._id, status: 'Confirmed' }, { $set: { status: 'Cancelled', cancelledAt } }, { session });
      await BookingSegment.deleteMany({ bookingId: booking._id }, { session });
      booking.status = 'Cancelled'; booking.cancelledAt = cancelledAt;
    });
  } finally {
    await session.endSession();
  }
  await audit(req.user._id, 'BOOKING_CANCELLED', 'Booking', booking._id);
  res.json({ booking });
}));

module.exports = router;
