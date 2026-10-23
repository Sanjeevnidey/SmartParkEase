const { slotIds, isValidSlot, slotIndex } = require('../src/lib/slots');
const { nowInZone, isCalendarDate, addDays, dayOfWeek } = require('../src/lib/time');
const { newReference, vehicleKey, hasStarted } = require('../src/lib/bookings');
const { predict, modelInfo } = require('../src/ml/predictor');
const vectors = require('./fixtures/demand-vectors.json');

describe('slots', () => {
  test('ids follow capacity in rows of ten', () => {
    expect(slotIds(12)).toEqual(['A-01', 'A-02', 'A-03', 'A-04', 'A-05', 'A-06', 'A-07', 'A-08', 'A-09', 'A-10', 'B-01', 'B-02']);
    expect(slotIds(270).at(-1)).toBe('AA-10');
    expect(slotIds(300).every((s, i) => slotIndex(s) === i)).toBe(true);
  });
  test('validation rejects spots outside the lot', () => {
    expect(isValidSlot('A-01', 1)).toBe(true);
    expect(isValidSlot('B-01', 10)).toBe(false);
    expect(isValidSlot('A-11', 50)).toBe(false);
    expect(isValidSlot('a-01', 50)).toBe(false);
    expect(isValidSlot('A-00', 50)).toBe(false);
  });
});

describe('time', () => {
  test('calendar dates', () => {
    expect(isCalendarDate('2026-02-28')).toBe(true);
    expect(isCalendarDate('2026-02-30')).toBe(false);
    expect(isCalendarDate('2026-2-3')).toBe(false);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(dayOfWeek('2026-10-26')).toBe(0); // a Monday
  });
  test('current date and hour are taken in the configured zone', () => {
    const instant = new Date('2026-10-23T20:30:00Z');
    expect(nowInZone('UTC', instant)).toEqual({ date: '2026-10-23', hour: 20, minute: 30 });
    expect(nowInZone('Asia/Kolkata', instant)).toEqual({ date: '2026-10-24', hour: 2, minute: 0 });
  });
});

describe('bookings helpers', () => {
  test('references are well-formed and do not repeat', () => {
    const refs = new Set(Array.from({ length: 5000 }, () => newReference('2026-10-23')));
    expect(refs.size).toBe(5000);
    for (const r of refs) expect(r).toMatch(/^PK-261023-[0-9A-HJKMNP-TV-Z]{6}$/);
  });
  test('vehicle key ignores spacing and case', () => {
    expect(vehicleKey('ka 01-ab 1234')).toBe('KA01AB1234');
  });
  test('a booking has started once its start hour begins', () => {
    const now = { date: '2026-10-23', hour: 10 };
    expect(hasStarted({ date: '2026-10-23', startHour: 10 }, now)).toBe(true);
    expect(hasStarted({ date: '2026-10-23', startHour: 11 }, now)).toBe(false);
    expect(hasStarted({ date: '2026-10-22', startHour: 23 }, now)).toBe(true);
  });
});

describe('demand model', () => {
  test('model file is loaded with its metadata', () => {
    const info = modelInfo();
    expect(info.classes.sort()).toEqual(['high', 'low', 'medium']);
    expect(info.trees).toBeGreaterThan(0);
    expect(info.trainingData.rows_by_source.synthetic).toBeGreaterThan(0);
  });
  test(`Node inference matches scikit-learn on ${vectors.length} held-out rows`, () => {
    let maxDiff = 0;
    for (const v of vectors) {
      const out = predict(v.input);
      expect(out.level).toBe(v.level);
      for (const [cls, p] of Object.entries(v.probabilities)) maxDiff = Math.max(maxDiff, Math.abs(out.probabilities[cls] - p));
    }
    // Leaf probabilities are rounded to 5 decimals in the export.
    expect(maxDiff).toBeLessThan(1e-4);
  });
  test('probabilities sum to 1', () => {
    const { probabilities } = predict({ lotType: 'Office', capacity: 40, price: 30, date: '2026-10-26', hour: 10 });
    expect(Object.values(probabilities).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 4);
  });
});
