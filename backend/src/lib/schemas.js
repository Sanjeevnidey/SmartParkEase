const { z } = require('zod');
const mongoose = require('mongoose');
const { LOT_TYPES } = require('../models');
const { isCalendarDate } = require('./time');

const VEHICLES = ['Sedan', 'Hatchback', 'SUV', 'Motorcycle', 'Electric vehicle', 'Van'];
const objectId = z.string().refine(v => mongoose.isValidObjectId(v) && /^[a-f\d]{24}$/i.test(v), 'Invalid id.');
const calendarDate = z.string().refine(isCalendarDate, 'Date must be a real date in YYYY-MM-DD format.');
const wholeHour = z.string().regex(/^([01]\d|2[0-4]):00$/, 'Times must be whole hours such as 09:00.');
const email = z.string().trim().toLowerCase().max(254).email('Enter a valid email address.');

const register = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(80),
  email,
  password: z.string().min(8, 'Password must be at least 8 characters.').max(128)
});
const login = z.object({ email: z.string().trim().toLowerCase().max(254), password: z.string().max(128) });
const updateMe = z.object({ name: z.string().trim().min(1, 'Name is required.').max(80) });

const lotQuery = z.object({
  type: z.enum(LOT_TYPES).optional(),
  area: z.string().max(80).optional(),
  q: z.string().max(80).optional()
});
const lotBody = z.object({
  name: z.string().trim().min(2).max(100),
  area: z.string().trim().min(2).max(80),
  address: z.string().trim().min(2).max(200),
  type: z.enum(LOT_TYPES).default('Mall'),
  price: z.coerce.number().min(0).max(10000),
  total: z.coerce.number().int().min(1).max(500),
  rating: z.coerce.number().min(0).max(5).optional(),
  features: z.array(z.string().trim().min(1).max(40)).max(12).default([])
});
const lotPatch = lotBody.partial().refine(v => Object.keys(v).length > 0, 'Nothing to update.');

const availabilityQuery = z.object({
  date: calendarDate,
  start: wholeHour.optional(),
  end: wholeHour.optional()
});

const bookingBody = z.object({
  lotId: objectId,
  slot: z.string().trim().toUpperCase().max(8),
  date: calendarDate,
  start: wholeHour,
  end: wholeHour,
  vehicle: z.enum(VEHICLES).default('Sedan'),
  plate: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9 -]{1,14}$/, 'Enter a licence plate of 2 to 15 letters, digits, spaces or dashes.')
});

const demandQuery = z.object({ lotId: objectId, date: calendarDate });
const idParam = z.object({ id: objectId });
const daysQuery = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) });

module.exports = { VEHICLES, register, login, updateMe, lotQuery, lotBody, lotPatch, availabilityQuery, bookingBody, demandQuery, idParam, daysQuery };
