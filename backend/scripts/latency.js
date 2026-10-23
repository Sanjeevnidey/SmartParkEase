// Measures API latency against a running server (local or deployed). Read-only except for the
// bookings it creates for the signed-in test user on spots of the first lot, 30 days ahead.
// Usage: API=http://localhost:4001/api EMAIL=... PASSWORD=... node scripts/latency.js [n=100]
const API = process.env.API || 'http://localhost:4001/api';
const n = Number(process.argv[2] || 100);

async function time(fn) { const t = process.hrtime.bigint(); const r = await fn(); return { ms: Number(process.hrtime.bigint() - t) / 1e6, r }; }
function summary(xs) { const s = [...xs].sort((a, b) => a - b); const q = p => s[Math.min(s.length - 1, Math.floor(p * s.length))]; return { n: s.length, p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +s.at(-1).toFixed(1) }; }

(async () => {
  const login = await (await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: process.env.EMAIL, password: process.env.PASSWORD }) })).json();
  if (!login.token) throw new Error('Login failed: ' + JSON.stringify(login));
  const auth = { Authorization: `Bearer ${login.token}` };
  const lot = (await (await fetch(`${API}/lots`)).json()).lots[0];
  const d = new Date(); d.setUTCDate(d.getUTCDate() + 30); const date = d.toISOString().slice(0, 10);
  const cases = {
    'GET /health': () => fetch(`${API}/health`),
    'GET /lots': () => fetch(`${API}/lots`),
    'GET /lots/:id/availability': () => fetch(`${API}/lots/${lot._id}/availability?date=${date}&start=09:00&end=12:00`),
    'GET /predictions/demand (24 h)': () => fetch(`${API}/predictions/demand?lotId=${lot._id}&date=${date}`, { headers: auth }),
  };
  const results = {};
  for (const [name, fn] of Object.entries(cases)) {
    await fn(); // warm-up
    const xs = [];
    for (let i = 0; i < n; i++) { const { ms, r } = await time(fn); if (!r.ok) throw new Error(`${name} -> ${r.status}`); await r.arrayBuffer(); xs.push(ms); }
    results[name] = summary(xs);
  }
  const bookingTimes = [];
  for (let i = 0; i < Math.min(n, lot.total); i++) {
    const slot = `${String.fromCharCode(65 + Math.floor(i / 10))}-${String((i % 10) + 1).padStart(2, '0')}`;
    const { ms, r } = await time(() => fetch(`${API}/bookings`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ lotId: lot._id, slot, date, start: '06:00', end: '07:00', plate: `LAT ${i}` }) }));
    if (r.status === 201) bookingTimes.push(ms);
  }
  if (bookingTimes.length) results['POST /bookings (transaction)'] = summary(bookingTimes);
  console.log(JSON.stringify({ api: API, date, results }, null, 2));
})().catch(e => { console.error(e.message); process.exit(1); });
