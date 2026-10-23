# Testing and results

All results below come from real runs on 2026-10-23 in a 4-vCPU Linux container with Node.js 22.22, MongoDB 7.0 (Docker, single-node replica set) and Chromium (Playwright). Nothing has been run against MongoDB Atlas, Render or AWS yet; those rows are marked **not run**.

## Automated tests (`backend/tests`, Jest + Supertest)

Command: `MONGODB_URI_TEST=... npm test`. Result: **4 suites, 51 tests, 51 passed** (14.1 s). Full output: [results/test-output.txt](results/test-output.txt). The concurrency suite was run 3 more times on its own: passed every time.

| Area | What is checked | Result |
|---|---|---|
| Health & headers | health reports database + model; helmet headers; `x-powered-by` removed | Pass |
| CORS | configured origin allowed; other origin gets no CORS header | Pass |
| API errors | unknown route 404; malformed JSON 400; body over 20 KB 413; bad ObjectId 400; unknown lot 404 | Pass |
| Authentication | input validation; duplicate email 409; email case-insensitive; `role` in sign-up body ignored; password hash never returned; same response for wrong password and unknown email | Pass |
| Injection | `{ "$ne": null }` in login body → 400; `?type[$ne]=x` → 400 | Pass |
| Tokens | missing, malformed, wrong-secret, `alg: none` and expired JWTs → 401 | Pass |
| Authorization | 5 admin routes: 401 without token, 403 for customers, 200 for admin; customers cannot create/edit/archive lots | Pass |
| Lots CRUD | create with validation, list, filter, text search, read, update, archive | Pass |
| Booking validation | past date, spot outside lot, end before start, non-whole hour, more than 60 days ahead, impossible date (Feb 30), missing plate, no token | Pass |
| Booking rules | amount and one segment per hour; overlapping same spot → 409 (both directions); back-to-back allowed; same vehicle in two spots → 409 | Pass |
| Availability | booked spots listed for the requested hours only | Pass |
| History & cancel | own history; cannot cancel another user's booking (404); cancel frees the spot; double cancel 409; admin can cancel; started booking cannot be cancelled; past booking becomes `Completed` | Pass |
| Admin reports | status totals add up; daily (7 rows), hourly (24 rows), per-lot analytics; invalid `days` 400; audit events recorded | Pass |
| Index use | availability query plan uses an index, no `COLLSCAN` | Pass |
| AI predictions | sign-in required; 24 hourly predictions with probabilities; invalid date 400; unknown lot 404; predictions do not change availability | Pass |
| ML parity | Node inference = scikit-learn on 300 held-out rows (same class every time, max probability difference < 1e-4) | Pass |
| Concurrency | 30 simultaneous requests for one spot/time → exactly 1 × 201, 29 × 409, 1 booking, 2 segments | Pass |
| Concurrency | 30 simultaneous partly-overlapping windows on one spot → no hour booked twice; segments = sum of winning durations | Pass |
| Concurrency | 30 simultaneous requests for 30 different spots → all 201 | Pass |
| Concurrency | cancel racing with 10 rebook attempts → at most one active booking | Pass |
| Rate limiting | 21st and 22nd sign-in attempts within 15 min → 429 | Pass |

## Experiments

| Experiment | Result | Raw data |
|---|---|---|
| 50 clients × 20 rounds racing for one spot | naive check-then-insert double-booked in 20/20 rounds (up to 50 winners); ParkEase design 0/20 | [results/race.json](results/race.json) |
| Availability query on 200,000 segments | collection scan examined 200,000 docs (89 ms); index examined 38 (under 1 ms) | [results/index.json](results/index.json) |
| API latency, local, 100 sequential calls each | see table below | [results/latency.json](results/latency.json) |

| Endpoint (local, not cloud) | p50 ms | p95 ms |
|---|---|---|
| GET /health | 2.0 | 3.1 |
| GET /lots | 4.4 | 6.7 |
| GET /lots/:id/availability | 4.0 | 7.1 |
| GET /predictions/demand (24 hours) | 5.3 | 7.6 |
| POST /bookings (transaction, 62 bookings) | 14.1 | 20.3 |

Rate limiting was turned off (`RATE_LIMIT=off`) for the latency run; with it on, the 61st prediction request in a minute was refused with 429, as designed. Cloud latency will be higher (network distance to Atlas, Lambda cold starts) and has **not been measured**.

## Browser smoke test (`e2e/smoke.cjs`)

Registers a new user, opens a lot, picks a time, books a spot, checks "My bookings", checks that the booked spot shows as booked, signs in as admin and loads the admin dashboard, and loads the explore page at phone width. Result on 2026-10-23: completed with **no browser console errors**; booking reference shown (e.g. `PK-261023-3FYB9Y`). Screenshots were saved.

## Not yet run

| Check | Why | How to run |
|---|---|---|
| Tests against MongoDB Atlas | needs the owner's rotated Atlas credentials | `MONGODB_URI=<atlas> node backend/scripts/race-demo.js 20 5` |
| AWS deployment health, CORS, throttling, latency | AWS deployment not yet approved | [AWS_DEPLOYMENT.md §4](AWS_DEPLOYMENT.md) |
| Render deployment after the upgrade | no access to the Render account | redeploy, then `curl https://<service>.onrender.com/api/health` |
| Load test with many users | out of scope for a college demo | e.g. `npx autocannon` against a non-production deployment |
| Frontend unit tests | the UI is covered by the browser smoke test only | — |
