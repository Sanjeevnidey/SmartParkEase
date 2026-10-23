// Inference for the Random Forest trained by ml/train.py. The forest is exported from
// scikit-learn as plain arrays, so the API needs no Python runtime: each tree is walked
// from the root (x[feature] <= threshold goes left) to a leaf holding class probabilities,
// and the forest's answer is the mean of the trees' probabilities, as in predict_proba.
const path = require('path');
const fs = require('fs');
const { dayOfWeek } = require('../lib/time');

let model;
function loadModel() {
  if (!model) model = JSON.parse(fs.readFileSync(path.join(__dirname, 'demand-model.json'), 'utf8'));
  return model;
}

function featureVector({ lotType, capacity, price, date, hour }) {
  const m = loadModel();
  const dow = dayOfWeek(date);
  const values = {
    hour, day_of_week: dow, is_weekend: dow >= 5 ? 1 : 0, month: Number(date.slice(5, 7)), capacity, price,
    ...Object.fromEntries(m.lotTypes.map(t => [`type_${t}`, lotType === t ? 1 : 0]))
  };
  return m.features.map(f => values[f]);
}

function treeProbabilities(tree, x) {
  let node = 0;
  while (tree.left[node] !== -1) node = x[tree.feature[node]] <= tree.threshold[node] ? tree.left[node] : tree.right[node];
  return tree.value[node];
}

function predict(input) {
  const m = loadModel();
  const x = featureVector(input);
  const sums = new Array(m.classes.length).fill(0);
  for (const tree of m.trees) treeProbabilities(tree, x).forEach((p, i) => { sums[i] += p; });
  const probabilities = Object.fromEntries(m.classes.map((c, i) => [c, sums[i] / m.trees.length]));
  const level = m.classes.reduce((best, c) => (probabilities[c] > probabilities[best] ? c : best), m.classes[0]);
  return { level, probabilities };
}

function modelInfo() {
  const { name, version, trainedAt, features, classes, thresholds, trainingData, metrics, trees } = loadModel();
  return { name, version, trainedAt, features, classes, thresholds, trainingData, metrics, trees: trees.length };
}

module.exports = { predict, featureVector, modelInfo, loadModel };
