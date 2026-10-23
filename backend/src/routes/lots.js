const express = require('express');
const { ParkingLot, Booking, BookingSegment } = require('../models');
const schemas = require('../lib/schemas');
const { HttpError, handle, validate, auth, audit } = require('../lib/http');
const { slotIds, slotIndex } = require('../lib/slots');
const { nowInZone } = require('../lib/time');
const { occupiedByLot } = require('../lib/bookings');

const router = express.Router();
const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function withLiveAvailability(lot, occupied) {
  const used = occupied.get(String(lot._id)) || 0;
  return { ...lot, occupiedNow: used, available: Math.max(0, lot.total - used) };
}

router.get('/', validate(schemas.lotQuery, 'query'), handle(async (req, res) => {
  const { type, area, q } = req.valid.query;
  const filter = { active: true };
  if (type) filter.type = type;
  if (area) filter.area = new RegExp(escapeRegex(area), 'i');
  if (q) filter.$text = { $search: q };
  const now = nowInZone();
  const [lots, occupied] = await Promise.all([
    ParkingLot.find(filter).sort({ rating: -1 }).limit(100).lean(),
    occupiedByLot(now.date, now.hour)
  ]);
  res.json({ lots: lots.map(l => withLiveAvailability(l, occupied)), asOf: now });
}));

router.get('/:id', validate(schemas.idParam, 'params'), handle(async (req, res) => {
  const lot = await ParkingLot.findOne({ _id: req.valid.params.id, active: true }).lean();
  if (!lot) throw new HttpError(404, 'Parking location not found.');
  const now = nowInZone();
  res.json({ lot: withLiveAvailability(lot, await occupiedByLot(now.date, now.hour)) });
}));

// Spot-by-spot availability for a date and (optionally) an hour range. A spot is "booked"
// if any of its hours in [start, end) is taken. Uses the lot_date_hour index.
router.get('/:id/availability', validate(schemas.idParam, 'params'), validate(schemas.availabilityQuery, 'query'), handle(async (req, res) => {
  const { date, start = '00:00', end = '24:00' } = req.valid.query;
  const startHour = Number(start.slice(0, 2)), endHour = Number(end.slice(0, 2));
  if (endHour <= startHour) throw new HttpError(400, 'End must be after start.');
  const lot = await ParkingLot.findOne({ _id: req.valid.params.id, active: true }).lean();
  if (!lot) throw new HttpError(404, 'Parking location not found.');
  const taken = await BookingSegment.distinct('slot', { lotId: lot._id, date, hour: { $gte: startHour, $lt: endHour } });
  const takenSet = new Set(taken);
  const slots = slotIds(lot.total).map(id => ({ id, state: takenSet.has(id) ? 'booked' : 'available' }));
  res.json({ lotId: lot._id, date, start, end, total: lot.total, booked: takenSet.size, available: lot.total - takenSet.size, slots });
}));

router.post('/', auth('admin'), validate(schemas.lotBody), handle(async (req, res) => {
  const lot = await ParkingLot.create({ ...req.valid.body, available: req.valid.body.total });
  await audit(req.user._id, 'LOT_CREATED', 'ParkingLot', lot._id, { name: lot.name });
  res.status(201).json({ lot });
}));

router.patch('/:id', auth('admin'), validate(schemas.idParam, 'params'), validate(schemas.lotPatch), handle(async (req, res) => {
  const lot = await ParkingLot.findOne({ _id: req.valid.params.id, active: true });
  if (!lot) throw new HttpError(404, 'Parking location not found.');
  const changes = req.valid.body;
  if (changes.total !== undefined && changes.total < lot.total) {
    // Integrity: do not remove spots that still have upcoming reservations.
    const today = nowInZone().date;
    const upcoming = await BookingSegment.distinct('slot', { lotId: lot._id, date: { $gte: today } });
    const blocked = upcoming.filter(s => slotIndex(s) >= changes.total);
    if (blocked.length) throw new HttpError(409, `Spots ${blocked.slice(0, 5).join(', ')} have upcoming bookings, so capacity cannot go below ${Math.max(...blocked.map(slotIndex)) + 1}.`);
  }
  Object.assign(lot, changes);
  await lot.save();
  await audit(req.user._id, 'LOT_UPDATED', 'ParkingLot', lot._id, changes);
  res.json({ lot });
}));

// Soft delete: the lot is archived so past bookings keep a valid reference.
router.delete('/:id', auth('admin'), validate(schemas.idParam, 'params'), handle(async (req, res) => {
  const today = nowInZone().date;
  const upcoming = await Booking.countDocuments({ lotId: req.valid.params.id, status: 'Confirmed', date: { $gte: today } });
  if (upcoming) throw new HttpError(409, `This location has ${upcoming} upcoming booking(s). Cancel them before archiving it.`);
  const lot = await ParkingLot.findOneAndUpdate({ _id: req.valid.params.id, active: true }, { active: false }, { new: true });
  if (!lot) throw new HttpError(404, 'Parking location not found.');
  await audit(req.user._id, 'LOT_ARCHIVED', 'ParkingLot', lot._id);
  res.json({ ok: true });
}));

module.exports = router;
