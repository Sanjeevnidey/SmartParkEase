const express = require('express');
const { ParkingLot, Booking, BookingSegment, ParkingEvent, User } = require('../models');
const schemas = require('../lib/schemas');
const { handle, validate, auth } = require('../lib/http');
const { nowInZone, addDays } = require('../lib/time');
const { completePastBookings } = require('../lib/bookings');

const router = express.Router();
router.use(auth('admin'));

router.get('/bookings', handle(async (_req, res) => {
  await completePastBookings();
  const bookings = await Booking.find().populate('userId', 'name email').sort({ createdAt: -1 }).limit(500).lean();
  res.json({ bookings });
}));

router.get('/summary', handle(async (_req, res) => {
  await completePastBookings();
  const [statusRows, lotsCount, revenueRows, popularRows, eventCount, customerCount] = await Promise.all([
    Booking.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    ParkingLot.countDocuments({ active: true }),
    Booking.aggregate([{ $match: { status: { $ne: 'Cancelled' } } }, { $group: { _id: null, revenue: { $sum: '$amount' }, hours: { $sum: { $subtract: ['$endHour', '$startHour'] } } } }]),
    Booking.aggregate([{ $match: { status: { $ne: 'Cancelled' } } }, { $group: { _id: '$lotId', lotName: { $first: '$lotName' }, bookings: { $sum: 1 }, revenue: { $sum: '$amount' } } }, { $sort: { bookings: -1 } }, { $limit: 5 }]),
    ParkingEvent.countDocuments(),
    User.countDocuments({ role: 'customer' })
  ]);
  const byStatus = Object.fromEntries(statusRows.map(r => [r._id, r.count]));
  const bookingCount = statusRows.reduce((s, r) => s + r.count, 0);
  res.json({
    bookingCount, activeCount: byStatus.Confirmed || 0, completedCount: byStatus.Completed || 0, cancelledCount: byStatus.Cancelled || 0,
    cancellationRate: bookingCount ? (byStatus.Cancelled || 0) / bookingCount : 0,
    lotsCount, customerCount, revenue: revenueRows[0]?.revenue || 0, bookedHours: revenueRows[0]?.hours || 0, popular: popularRows, eventCount
  });
}));

// Bookings and revenue per reservation date (not creation date), filling empty days with zero.
router.get('/analytics/daily', validate(schemas.daysQuery, 'query'), handle(async (req, res) => {
  const { days } = req.valid.query;
  const today = nowInZone().date;
  const since = addDays(today, -(days - 1));
  const rows = await Booking.aggregate([
    { $match: { date: { $gte: since, $lte: today }, status: { $ne: 'Cancelled' } } },
    { $group: { _id: '$date', bookings: { $sum: 1 }, revenue: { $sum: '$amount' } } }
  ]);
  const byDate = new Map(rows.map(r => [r._id, r]));
  const daily = Array.from({ length: days }, (_, i) => {
    const date = addDays(since, i);
    return { _id: date, bookings: byDate.get(date)?.bookings || 0, revenue: byDate.get(date)?.revenue || 0 };
  });
  res.json({ daily });
}));

// Average occupancy by hour of day over the last N days: occupied spot-hours / available spot-hours.
router.get('/analytics/hourly', validate(schemas.daysQuery, 'query'), handle(async (req, res) => {
  const { days } = req.valid.query;
  const today = nowInZone().date;
  const since = addDays(today, -(days - 1));
  const [rows, capacity] = await Promise.all([
    BookingSegment.aggregate([
      { $match: { date: { $gte: since, $lte: today } } },
      { $group: { _id: '$hour', occupiedSpotHours: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]),
    ParkingLot.aggregate([{ $match: { active: true } }, { $group: { _id: null, spots: { $sum: '$total' } } }])
  ]);
  const spots = capacity[0]?.spots || 0;
  const byHour = new Map(rows.map(r => [r._id, r.occupiedSpotHours]));
  const hourly = Array.from({ length: 24 }, (_, hour) => {
    const occupied = byHour.get(hour) || 0;
    return { hour, occupiedSpotHours: occupied, occupancyRate: spots ? occupied / (spots * days) : 0 };
  });
  res.json({ days, spots, hourly });
}));

// Revenue and utilisation per lot: a $lookup join from bookings to parkinglots.
router.get('/analytics/lots', handle(async (_req, res) => {
  const lots = await Booking.aggregate([
    { $match: { status: { $ne: 'Cancelled' } } },
    { $group: { _id: '$lotId', bookings: { $sum: 1 }, revenue: { $sum: '$amount' }, hours: { $sum: { $subtract: ['$endHour', '$startHour'] } } } },
    { $lookup: { from: 'parkinglots', localField: '_id', foreignField: '_id', as: 'lot' } },
    { $unwind: '$lot' },
    { $project: { _id: 0, lotId: '$_id', name: '$lot.name', type: '$lot.type', total: '$lot.total', bookings: 1, revenue: 1, hours: 1, avgHoursPerBooking: { $round: [{ $divide: ['$hours', '$bookings'] }, 2] } } },
    { $sort: { revenue: -1 } }
  ]);
  res.json({ lots });
}));

// Query-plan demo for the viva: shows that the availability query is answered from an index.
router.get('/db/explain', handle(async (_req, res) => {
  const lot = await ParkingLot.findOne({ active: true }).lean();
  if (!lot) return res.json({ note: 'Seed at least one lot first.' });
  const date = nowInZone().date;
  const plan = await BookingSegment.find({ lotId: lot._id, date, hour: { $gte: 9, $lt: 12 } }).explain('executionStats');
  const stats = plan.executionStats || {};
  const findIndex = stage => !stage ? null : stage.indexName || findIndex(stage.inputStage);
  res.json({
    query: { lotId: lot._id, date, hour: { $gte: 9, $lt: 12 } },
    indexUsed: findIndex(plan.queryPlanner?.winningPlan),
    winningStage: plan.queryPlanner?.winningPlan?.stage,
    nReturned: stats.nReturned, totalKeysExamined: stats.totalKeysExamined, totalDocsExamined: stats.totalDocsExamined, executionTimeMillis: stats.executionTimeMillis
  });
}));

router.get('/events', handle(async (_req, res) => {
  const events = await ParkingEvent.find().sort({ createdAt: -1 }).limit(100).lean();
  res.json({ events });
}));

module.exports = router;
