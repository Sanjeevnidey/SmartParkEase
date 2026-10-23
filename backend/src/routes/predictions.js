const express = require('express');
const { ParkingLot } = require('../models');
const schemas = require('../lib/schemas');
const { HttpError, handle, validate, auth } = require('../lib/http');
const { predict, modelInfo } = require('../ml/predictor');

const router = express.Router();
router.use(auth());

// Predicted demand for each hour of a date at one lot. This is a forecast only: it never
// decides whether a spot can be booked. Real availability comes from /lots/:id/availability
// and booking validity is enforced by the database constraints in routes/bookings.js.
router.get('/demand', validate(schemas.demandQuery, 'query'), handle(async (req, res) => {
  const { lotId, date } = req.valid.query;
  const lot = await ParkingLot.findOne({ _id: lotId, active: true }).lean();
  if (!lot) throw new HttpError(404, 'Parking location not found.');
  const hours = Array.from({ length: 24 }, (_, hour) => {
    const { level, probabilities } = predict({ lotType: lot.type, capacity: lot.total, price: lot.price, date, hour });
    return { hour, level, confidence: Math.round(probabilities[level] * 1000) / 1000, probabilities };
  });
  const info = modelInfo();
  res.json({
    lotId: lot._id, lotName: lot.name, date, hours,
    model: { name: info.name, version: info.version, trainedOn: info.trainingData.rows_by_source },
    disclaimer: 'Predicted demand from a model trained mostly on synthetic data. It is not live availability.'
  });
}));

router.get('/model', (_req, res) => res.json({ model: modelInfo() }));

module.exports = router;
