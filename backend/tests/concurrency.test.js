// Concurrency tests: many requests are fired at the same instant against a real MongoDB
// replica set. They check that the unique indexes + transactions keep the data consistent.
process.env.RATE_LIMIT = 'off';
const h = require('./helpers');
const app = require('../src/app');
const { request, models, bearer } = h;

let users, lot;
beforeAll(async () => {
  await h.connect('parkease_test_concurrency');
  users = await Promise.all(Array.from({ length: 30 }, (_, i) => h.makeUser('customer', `Racer ${i}`)));
  lot = await h.makeLot({ total: 40 });
});
afterAll(h.disconnect);

const attempt = (u, body, tag = 'R') => request(app).post('/api/bookings').set(bearer(u.token))
  .send({ lotId: String(lot._id), date: h.tomorrow(), plate: `${tag} ${u.user._id.toString().slice(-6)}`, ...body });

test('30 simultaneous requests for the same spot and time: exactly one succeeds', async () => {
  const results = await Promise.all(users.map(u => attempt(u, { slot: 'A-01', start: '10:00', end: '12:00' })));
  const codes = results.map(r => r.status);
  expect(codes.filter(c => c === 201)).toHaveLength(1);
  expect(codes.filter(c => c === 409)).toHaveLength(29);
  expect(await models.Booking.countDocuments({ lotId: lot._id, slot: 'A-01' })).toBe(1);
  expect(await models.BookingSegment.countDocuments({ lotId: lot._id, slot: 'A-01' })).toBe(2);
});

test('30 simultaneous overlapping windows on one spot: no hour is ever double-booked', async () => {
  // Each test uses its own plates (tag) so the one-vehicle-one-spot rule does not interfere.
  // Windows start at 08:00..19:00 with lengths 1-4 hours, so many overlap partially.
  const results = await Promise.all(users.map((u, i) => attempt(u, { slot: 'A-02', start: `${String(8 + (i % 12)).padStart(2, '0')}:00`, end: `${String(Math.min(24, 8 + (i % 12) + 1 + (i % 4))).padStart(2, '0')}:00` }, 'O')));
  expect(results.every(r => r.status === 201 || r.status === 409)).toBe(true);
  const winners = await models.Booking.find({ lotId: lot._id, slot: 'A-02', status: 'Confirmed' }).lean();
  const hours = winners.flatMap(b => Array.from({ length: b.endHour - b.startHour }, (_, k) => b.startHour + k));
  expect(new Set(hours).size).toBe(hours.length); // no duplicates
  expect(await models.BookingSegment.countDocuments({ lotId: lot._id, slot: 'A-02' })).toBe(hours.length);
  // Every booking that committed has all of its segments (atomicity): segments == sum of durations.
  expect(winners.length).toBe(results.filter(r => r.status === 201).length);
});

test('30 simultaneous requests for 30 different spots: all succeed', async () => {
  const results = await Promise.all(users.map((u, i) => attempt(u, { slot: `${String.fromCharCode(66 + Math.floor(i / 10))}-${String((i % 10) + 1).padStart(2, '0')}`, start: '14:00', end: '15:00' }, 'S')));
  expect(results.map(r => r.status).filter(c => c !== 201)).toEqual([]);
});

test('simultaneous cancel and rebook of one spot never leaves two active bookings', async () => {
  const first = await attempt(users[0], { slot: 'A-05', start: '20:00', end: '21:00' }, 'C');
  expect(first.status).toBe(201);
  const [cancel, ...rebooks] = await Promise.all([
    request(app).post(`/api/bookings/${first.body.booking._id}/cancel`).set(bearer(users[0].token)),
    ...users.slice(1, 11).map(u => attempt(u, { slot: 'A-05', start: '20:00', end: '21:00' }, 'C'))
  ]);
  expect(cancel.status).toBe(200);
  expect(rebooks.filter(r => r.status === 201).length).toBeLessThanOrEqual(1);
  expect(await models.Booking.countDocuments({ lotId: lot._id, slot: 'A-05', status: 'Confirmed' })).toBeLessThanOrEqual(1);
});
