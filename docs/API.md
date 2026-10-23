# ParkEase API

Base path `/api`. JSON in and out. Authenticated routes need `Authorization: Bearer <token>` (from register or login, valid 8 hours). Errors are `{ "error": "message" }` with a matching HTTP status.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | /health | none | Service, database and model status (503 if degraded) |
| POST | /auth/register | none | `{name, email, password}` → token + user (always role `customer`) |
| POST | /auth/login | none | `{email, password}` → token + user |
| GET | /auth/me | user | Current user |
| PATCH | /auth/me | user | `{name}` |
| GET | /lots | none | Active lots with live `available` / `occupiedNow`; filters `type`, `area`, `q` (text search) |
| GET | /lots/:id | none | One lot |
| GET | /lots/:id/availability | none | `?date=YYYY-MM-DD&start=HH:00&end=HH:00` → every spot with state `available` / `booked` |
| POST | /lots | admin | Create lot `{name, area, address, type, price, total, features}` |
| PATCH | /lots/:id | admin | Update fields; refuses to shrink capacity below spots with upcoming bookings |
| DELETE | /lots/:id | admin | Archive (soft delete); refused while upcoming bookings exist |
| POST | /bookings | user | `{lotId, slot, date, start, end, vehicle, plate}` → 201, or 409 if the spot or vehicle is taken |
| GET | /bookings/mine | user | Booking history (past bookings are marked `Completed` first) |
| POST | /bookings/:id/cancel | owner or admin | Cancel a booking that has not started; frees its hours |
| GET | /predictions/demand | user | `?lotId&date` → 24 hourly `{hour, level, confidence, probabilities}` |
| GET | /predictions/model | user | Model version, training data summary, test metrics |
| GET | /admin/summary | admin | Counts by status, revenue, cancellation rate, top lots |
| GET | /admin/bookings | admin | Latest 500 bookings with customer name |
| GET | /admin/analytics/daily | admin | `?days=1..90` bookings and revenue per reservation date |
| GET | /admin/analytics/hourly | admin | `?days=` occupancy rate by hour of day |
| GET | /admin/analytics/lots | admin | Revenue, hours and average length per lot (`$lookup`) |
| GET | /admin/db/explain | admin | Query plan of the availability query (index used, keys/docs examined) |
| GET | /admin/events | admin | Latest 100 audit events |

Rate limits (per client IP, per server instance): 600 requests / 15 min on `/api`, 20 / 15 min on login and register, 60 / min on predictions. On AWS the HTTP API also throttles at 10 requests/s (burst 20).
