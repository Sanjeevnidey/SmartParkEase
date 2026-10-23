process.env.RATE_LIMIT = 'on';
const h = require('./helpers');
const app = require('../src/app');
const { request } = h;

beforeAll(() => h.connect('parkease_test_ratelimit'));
afterAll(h.disconnect);

test('sign-in is limited to 20 attempts per 15 minutes per client', async () => {
  const codes = [];
  for (let i = 0; i < 22; i++) codes.push((await request(app).post('/api/auth/login').send({ email: 'x@test.local', password: 'wrong-password' })).status);
  expect(codes.slice(0, 20).every(c => c === 401)).toBe(true);
  expect(codes.slice(20)).toEqual([429, 429]);
});
