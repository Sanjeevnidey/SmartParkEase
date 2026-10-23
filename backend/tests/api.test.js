process.env.RATE_LIMIT = 'off';
const jwt = require('jsonwebtoken');
const h = require('./helpers');
const app = require('../src/app');
const { request, models, bearer } = h;

let customer, other, admin, lot;
beforeAll(async () => {
  await h.connect('parkease_test_api');
  customer = await h.makeUser('customer', 'Casey Customer');
  other = await h.makeUser('customer', 'Olive Other');
  admin = await h.makeUser('admin', 'Ada Admin');
  lot = await h.makeLot({ total: 20, price: 40 });
});
afterAll(h.disconnect);

const book = (token, body) => request(app).post('/api/bookings').set(bearer(token)).send({ lotId: String(lot._id), slot: 'A-01', date: h.tomorrow(), start: '10:00', end: '12:00', plate: `T ${Math.random().toString(36).slice(2, 8)}`, ...body });

describe('health and security headers', () => {
  test('health reports database and model', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'connected' });
    expect(res.body.model).toMatch(/^\d{8}-1$/);
  });
  test('helmet headers are set and x-powered-by is removed', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
  test('CORS allows configured origins only', async () => {
    const ok = await request(app).get('/api/lots').set('Origin', 'https://parkease.example.com');
    expect(ok.headers['access-control-allow-origin']).toBe('https://parkease.example.com');
    const bad = await request(app).get('/api/lots').set('Origin', 'https://evil.example');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });
  test('unknown routes, bad JSON and oversized bodies get clean errors', async () => {
    expect((await request(app).get('/api/nope')).status).toBe(404);
    const badJson = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":');
    expect(badJson.status).toBe(400);
    const big = await request(app).post('/api/auth/login').send({ email: 'a@b.c', password: 'x'.repeat(30000) });
    expect(big.status).toBe(413);
  });
});

describe('authentication', () => {
  test('register validates input', async () => {
    expect((await request(app).post('/api/auth/register').send({ name: 'A', email: 'bad', password: 'password123' })).status).toBe(400);
    expect((await request(app).post('/api/auth/register').send({ name: 'A', email: 'a@b.co', password: 'short' })).status).toBe(400);
    expect((await request(app).post('/api/auth/register').send({ name: { $gt: '' }, email: 'a@b.co', password: 'password123' })).status).toBe(400);
  });
  test('register, duplicate email, login, me', async () => {
    const reg = await request(app).post('/api/auth/register').send({ name: 'New Person', email: 'New.Person@Test.local', password: 'password123', role: 'admin' });
    expect(reg.status).toBe(201);
    expect(reg.body.user).toMatchObject({ email: 'new.person@test.local', role: 'customer' }); // role in body is ignored
    expect(reg.body.user.passwordHash).toBeUndefined();
    expect((await request(app).post('/api/auth/register').send({ name: 'Again', email: 'new.person@test.local', password: 'password123' })).status).toBe(409);
    const login = await request(app).post('/api/auth/login').send({ email: 'NEW.person@test.local', password: 'password123' });
    expect(login.status).toBe(200);
    const me = await request(app).get('/api/auth/me').set(bearer(login.body.token));
    expect(me.body.user.name).toBe('New Person');
  });
  test('wrong password and unknown email give the same answer', async () => {
    const a = await request(app).post('/api/auth/login').send({ email: customer.email, password: 'wrong-password' });
    const b = await request(app).post('/api/auth/login').send({ email: 'nobody@test.local', password: 'wrong-password' });
    expect(a.status).toBe(401); expect(b.status).toBe(401); expect(a.body).toEqual(b.body);
  });
  test('login rejects operator injection', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: { $ne: null }, password: { $ne: null } });
    expect(res.status).toBe(400);
  });
  test('invalid, forged and alg=none tokens are rejected', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set(bearer('garbage'))).status).toBe(401);
    const forged = jwt.sign({ sub: String(admin.user._id), role: 'admin' }, 'not-the-secret');
    expect((await request(app).get('/api/auth/me').set(bearer(forged))).status).toBe(401);
    const none = jwt.sign({ sub: String(admin.user._id), role: 'admin' }, null, { algorithm: 'none' });
    expect((await request(app).get('/api/auth/me').set(bearer(none))).status).toBe(401);
    const expired = jwt.sign({ sub: String(customer.user._id), role: 'customer', exp: Math.floor(Date.now() / 1000) - 10 }, process.env.JWT_SECRET);
    expect((await request(app).get('/api/auth/me').set(bearer(expired))).status).toBe(401);
  });
  test('profile name can be updated', async () => {
    const res = await request(app).patch('/api/auth/me').set(bearer(customer.token)).send({ name: 'Casey C.', role: 'admin' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ name: 'Casey C.', role: 'customer' });
  });
});

describe('authorization', () => {
  test.each(['/api/admin/summary', '/api/admin/bookings', '/api/admin/events', '/api/admin/analytics/daily', '/api/admin/db/explain'])('%s needs an admin', async path => {
    expect((await request(app).get(path)).status).toBe(401);
    expect((await request(app).get(path).set(bearer(customer.token))).status).toBe(403);
    expect((await request(app).get(path).set(bearer(admin.token))).status).toBe(200);
  });
  test('customers cannot create, edit or archive lots', async () => {
    const body = { name: 'Hack Lot', area: 'X area', address: '1 Road', type: 'Mall', price: 1, total: 5 };
    expect((await request(app).post('/api/lots').set(bearer(customer.token)).send(body)).status).toBe(403);
    expect((await request(app).patch(`/api/lots/${lot._id}`).set(bearer(customer.token)).send({ price: 0 })).status).toBe(403);
    expect((await request(app).delete(`/api/lots/${lot._id}`).set(bearer(customer.token))).status).toBe(403);
  });
});

describe('parking lots (CRUD)', () => {
  let created;
  test('admin creates a lot with validation', async () => {
    expect((await request(app).post('/api/lots').set(bearer(admin.token)).send({ name: 'X' })).status).toBe(400);
    expect((await request(app).post('/api/lots').set(bearer(admin.token)).send({ name: 'Bad Type', area: 'Area', address: 'Addr', type: 'Castle', price: 1, total: 5 })).status).toBe(400);
    const res = await request(app).post('/api/lots').set(bearer(admin.token)).send({ name: 'Riverside Test', area: 'Riverside', address: '5 River Road', type: 'Office', price: 25, total: 30, features: ['CCTV'] });
    expect(res.status).toBe(201);
    created = res.body.lot;
  });
  test('list, filter, search and read one', async () => {
    const all = await request(app).get('/api/lots');
    expect(all.body.lots.length).toBeGreaterThanOrEqual(2);
    const offices = await request(app).get('/api/lots?type=Office');
    expect(offices.body.lots.every(l => l.type === 'Office')).toBe(true);
    const searched = await request(app).get('/api/lots?q=Riverside');
    expect(searched.body.lots.map(l => l.name)).toContain('Riverside Test');
    const one = await request(app).get(`/api/lots/${created._id}`);
    expect(one.body.lot).toMatchObject({ name: 'Riverside Test', available: 30, occupiedNow: 0 });
  });
  test('query operators and bad ids are rejected', async () => {
    expect((await request(app).get('/api/lots?type[$ne]=x')).status).toBe(400);
    expect((await request(app).get('/api/lots/not-an-id')).status).toBe(400);
    expect((await request(app).get('/api/lots/64b000000000000000000000')).status).toBe(404);
  });
  test('admin updates and archives a lot', async () => {
    const upd = await request(app).patch(`/api/lots/${created._id}`).set(bearer(admin.token)).send({ price: 28 });
    expect(upd.body.lot.price).toBe(28);
    expect((await request(app).delete(`/api/lots/${created._id}`).set(bearer(admin.token))).status).toBe(200);
    expect((await request(app).get(`/api/lots/${created._id}`)).status).toBe(404);
  });
});

describe('bookings', () => {
  test('validation: past start, bad spot, bad times, too far ahead, missing plate', async () => {
    expect((await book(customer.token, { date: '2020-01-01' })).status).toBe(400);
    expect((await book(customer.token, { slot: 'C-01' })).status).toBe(400); // lot has 20 spots: A and B rows
    expect((await book(customer.token, { start: '12:00', end: '10:00' })).status).toBe(400);
    expect((await book(customer.token, { start: '10:30' })).status).toBe(400);
    expect((await book(customer.token, { date: '2099-01-01' })).status).toBe(400);
    expect((await book(customer.token, { date: '2026-02-30' })).status).toBe(400);
    expect((await book(customer.token, { plate: '' })).status).toBe(400);
    expect((await request(app).post('/api/bookings').send({})).status).toBe(401);
  });

  test('a booking is created with a reference, amount and one segment per hour', async () => {
    const res = await book(customer.token, { slot: 'A-02', start: '09:00', end: '12:00', plate: 'KA 01 AB 1234' });
    expect(res.status).toBe(201);
    expect(res.body.booking).toMatchObject({ slot: 'A-02', amount: 120, status: 'Confirmed', plate: 'KA 01 AB 1234' });
    expect(res.body.booking.reference).toMatch(/^PK-\d{6}-[0-9A-Z]{6}$/);
    const segs = await models.BookingSegment.find({ bookingId: res.body.booking._id }).lean();
    expect(segs.map(s => s.hour).sort((a, b) => a - b)).toEqual([9, 10, 11]);
  });

  test('overlapping booking of the same spot is refused; touching and other spots are allowed', async () => {
    expect((await book(other.token, { slot: 'A-02', start: '11:00', end: '13:00' })).status).toBe(409);
    expect((await book(other.token, { slot: 'A-02', start: '08:00', end: '10:00' })).status).toBe(409);
    expect((await book(other.token, { slot: 'A-02', start: '12:00', end: '14:00' })).status).toBe(201); // starts when the other ends
    expect((await book(other.token, { slot: 'A-03', start: '09:00', end: '12:00' })).status).toBe(201);
  });

  test('the same vehicle cannot hold two spots at the same time', async () => {
    const res = await book(customer.token, { slot: 'B-05', start: '10:00', end: '11:00', plate: 'ka01ab1234' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Vehicle/);
  });

  test('availability shows booked spots for the requested hours', async () => {
    const res = await request(app).get(`/api/lots/${lot._id}/availability?date=${h.tomorrow()}&start=10:00&end=11:00`);
    expect(res.status).toBe(200);
    expect(res.body.slots).toHaveLength(20);
    const booked = res.body.slots.filter(s => s.state === 'booked').map(s => s.id).sort();
    expect(booked).toEqual(['A-02', 'A-03']);
    const later = await request(app).get(`/api/lots/${lot._id}/availability?date=${h.tomorrow()}&start=15:00&end=16:00`);
    expect(later.body.booked).toBe(0);
    expect((await request(app).get(`/api/lots/${lot._id}/availability?date=tomorrow`)).status).toBe(400);
  });

  test('history, cancel rules and freeing the spot', async () => {
    const created = await book(customer.token, { slot: 'B-01', start: '15:00', end: '17:00' });
    const id = created.body.booking._id;
    const mine = await request(app).get('/api/bookings/mine').set(bearer(customer.token));
    expect(mine.body.bookings.map(b => b._id)).toContain(id);
    expect((await request(app).post(`/api/bookings/${id}/cancel`).set(bearer(other.token))).status).toBe(404); // not theirs
    const cancel = await request(app).post(`/api/bookings/${id}/cancel`).set(bearer(customer.token));
    expect(cancel.status).toBe(200);
    expect(cancel.body.booking.status).toBe('Cancelled');
    expect((await request(app).post(`/api/bookings/${id}/cancel`).set(bearer(customer.token))).status).toBe(409);
    expect(await models.BookingSegment.countDocuments({ bookingId: id })).toBe(0);
    expect((await book(other.token, { slot: 'B-01', start: '15:00', end: '17:00' })).status).toBe(201); // spot is free again
  });

  test('admins can cancel any upcoming booking', async () => {
    const created = await book(customer.token, { slot: 'B-09', start: '18:00', end: '19:00' });
    const res = await request(app).post(`/api/bookings/${created.body.booking._id}/cancel`).set(bearer(admin.token));
    expect(res.status).toBe(200);
  });

  test('past bookings become Completed and started bookings cannot be cancelled', async () => {
    const base = { userId: customer.user._id, lotId: lot._id, lotName: lot.name, slot: 'B-10', start: '00:00', end: '01:00', startHour: 0, endHour: 1, amount: 40, plate: 'OLD 1' };
    const past = await models.Booking.create({ ...base, reference: 'PK-PAST-000001', date: '2025-01-01' });
    const started = await models.Booking.create({ ...base, reference: 'PK-PAST-000002', date: h.today(), endHour: 24, end: '24:00' });
    const mine = await request(app).get('/api/bookings/mine').set(bearer(customer.token));
    expect(mine.body.bookings.find(b => b._id === String(past._id)).status).toBe('Completed');
    expect((await request(app).post(`/api/bookings/${started._id}/cancel`).set(bearer(customer.token))).status).toBe(409);
  });
});

describe('admin reports', () => {
  test('summary aggregates by status', async () => {
    const res = await request(app).get('/api/admin/summary').set(bearer(admin.token));
    const { bookingCount, activeCount, completedCount, cancelledCount } = res.body;
    expect(bookingCount).toBe(activeCount + completedCount + cancelledCount);
    expect(cancelledCount).toBeGreaterThanOrEqual(2);
    expect(res.body.revenue).toBeGreaterThan(0);
  });
  test('daily, hourly and per-lot analytics', async () => {
    const daily = await request(app).get('/api/admin/analytics/daily?days=7').set(bearer(admin.token));
    expect(daily.body.daily).toHaveLength(7);
    const hourly = await request(app).get('/api/admin/analytics/hourly?days=7').set(bearer(admin.token));
    expect(hourly.body.hourly).toHaveLength(24);
    const lots = await request(app).get('/api/admin/analytics/lots').set(bearer(admin.token));
    expect(lots.body.lots[0]).toHaveProperty('avgHoursPerBooking');
    expect((await request(app).get('/api/admin/analytics/daily?days=999').set(bearer(admin.token))).status).toBe(400);
  });
  test('availability query is served by an index (no collection scan)', async () => {
    const res = await request(app).get('/api/admin/db/explain').set(bearer(admin.token));
    expect(res.body.indexUsed).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toMatch(/COLLSCAN/);
  });
  test('audit events are recorded', async () => {
    const res = await request(app).get('/api/admin/events').set(bearer(admin.token));
    const actions = res.body.events.map(e => e.action);
    expect(actions).toEqual(expect.arrayContaining(['BOOKING_CONFIRMED', 'BOOKING_CANCELLED', 'LOT_CREATED']));
  });
});

describe('demand predictions', () => {
  test('requires sign-in', async () => {
    expect((await request(app).get(`/api/predictions/demand?lotId=${lot._id}&date=${h.tomorrow()}`)).status).toBe(401);
  });
  test('returns 24 hourly predictions with probabilities and a disclaimer', async () => {
    const res = await request(app).get(`/api/predictions/demand?lotId=${lot._id}&date=${h.tomorrow()}`).set(bearer(customer.token));
    expect(res.status).toBe(200);
    expect(res.body.hours).toHaveLength(24);
    for (const hr of res.body.hours) {
      expect(['low', 'medium', 'high']).toContain(hr.level);
      expect(hr.probabilities[hr.level]).toBeCloseTo(hr.confidence, 2);
    }
    expect(res.body.disclaimer).toMatch(/not live availability/);
  });
  test('validates input and unknown lots', async () => {
    expect((await request(app).get(`/api/predictions/demand?lotId=${lot._id}&date=soon`).set(bearer(customer.token))).status).toBe(400);
    expect((await request(app).get(`/api/predictions/demand?lotId=64b000000000000000000000&date=${h.tomorrow()}`).set(bearer(customer.token))).status).toBe(404);
  });
  test('prediction never changes availability', async () => {
    const before = await request(app).get(`/api/lots/${lot._id}/availability?date=${h.tomorrow()}`);
    await request(app).get(`/api/predictions/demand?lotId=${lot._id}&date=${h.tomorrow()}`).set(bearer(customer.token));
    const after = await request(app).get(`/api/lots/${lot._id}/availability?date=${h.tomorrow()}`);
    expect(after.body).toEqual(before.body);
  });
});
