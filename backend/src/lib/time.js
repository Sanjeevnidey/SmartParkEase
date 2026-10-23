// All booking dates and hours are local to the parking network, set by APP_TIMEZONE
// (an IANA name such as "Asia/Kolkata"). Server clocks run in UTC, so "today" and
// "the current hour" must be computed in that zone, not with new Date().getHours().
function appTimezone() {
  return process.env.APP_TIMEZONE || 'UTC';
}

function nowInZone(timeZone = appTimezone(), now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) };
}

// True for a real calendar date in YYYY-MM-DD form (rejects 2026-02-30).
function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Day of week for a YYYY-MM-DD date, Monday = 0 ... Sunday = 6 (same convention as pandas).
function dayOfWeek(date) {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

module.exports = { appTimezone, nowInZone, isCalendarDate, addDays, dayOfWeek };
