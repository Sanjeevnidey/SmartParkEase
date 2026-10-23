// Builds the IEEE conference-style paper (docs/paper/ParkEase-IEEE-paper.docx).
// All numbers are read from docs/results/*.json, so the paper always matches the measured results.
// Usage: node docs/paper/build-paper.js   (needs the `docx` npm package)
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, AlignmentType, WidthType,
  BorderStyle, SectionType, ShadingType, VerticalAlign, LineRuleType, Footer, PageNumber
} = require('docx');

const ROOT = path.resolve(__dirname, '../..');
const R = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/results', f), 'utf8'));
const ml = R('ml-metrics.json'), race = R('race.json'), idx = R('index.json'), lat = R('latency.json');
const pct = x => `${(Math.round(x * 1000 + 1e-6) / 10).toFixed(1)}%`;
const n = x => x.toLocaleString('en-US');

const FONT = 'Times New Roman';
const PAGE = { width: 12240, height: 15840 };
const MARGIN = { top: 1080, bottom: 1440, left: 900, right: 900 };   // 0.75", 1", 0.625"
const TEXT_W = PAGE.width - MARGIN.left - MARGIN.right;             // 10440 = 7.25"
const COL_SPACE = 360;                                               // 0.25"
const COL_W = (TEXT_W - COL_SPACE) / 2;                              // 5040 = 3.5"
const dxaToPx = d => Math.round(d / 1440 * 96);

// ---------- text helpers ----------
// Inline markup: *italic*, **bold**, `code` (Courier).
function runs(text, base = {}) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), font: FONT, ...base }));
    const t = m[0];
    if (t.startsWith('**')) out.push(new TextRun({ text: t.slice(2, -2), bold: true, font: FONT, ...base }));
    else if (t.startsWith('`')) out.push(new TextRun({ text: t.slice(1, -1), font: 'Courier New', ...base, size: (base.size || 20) - 2 }));
    else out.push(new TextRun({ text: t.slice(1, -1), italics: true, font: FONT, ...base }));
    last = m.index + t.length;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), font: FONT, ...base }));
  return out;
}
const P = (text, opts = {}) => new Paragraph({
  children: runs(text, { size: 20 }), alignment: AlignmentType.JUSTIFIED,
  indent: opts.noIndent ? undefined : { firstLine: 245 }, spacing: { after: 0, line: 228, lineRule: LineRuleType.EXACT }, ...opts.p
});
const roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
let h1count = 0, h2count = 0;
const H1 = text => { h2count = 0; return new Paragraph({ children: [new TextRun({ text: `${roman[h1count++]}. ${text}`, font: FONT, size: 20, smallCaps: true })], alignment: AlignmentType.CENTER, spacing: { before: 160, after: 80 }, keepNext: true }); };
const H2 = text => new Paragraph({ children: [new TextRun({ text: `${String.fromCharCode(65 + h2count++)}. ${text}`, font: FONT, size: 20, italics: true })], spacing: { before: 100, after: 40 }, keepNext: true });
const bullet = text => new Paragraph({ children: runs(text, { size: 20 }), alignment: AlignmentType.JUSTIFIED, indent: { left: 245, hanging: 160 }, spacing: { after: 0, line: 228, lineRule: LineRuleType.EXACT }, numbering: { reference: 'bullets', level: 0 } });
const numbered = (text, ref) => new Paragraph({ children: runs(text, { size: 20 }), alignment: AlignmentType.JUSTIFIED, indent: { left: 300, hanging: 220 }, spacing: { after: 0, line: 228, lineRule: LineRuleType.EXACT }, numbering: { reference: ref, level: 0 } });

// ---------- figures and tables ----------
let figNo = 0, tabNo = 0;
function figure(file, widthDxa, caption) {
  const img = path.join(ROOT, file);
  const { w, h } = pngSize(img);
  const width = dxaToPx(widthDxa), height = Math.round(width * h / w);
  figNo++;
  return [
    new Paragraph({ children: [new ImageRun({ type: 'png', data: fs.readFileSync(img), transformation: { width, height }, altText: { title: `Fig. ${figNo}`, description: caption, name: `fig${figNo}` } })], alignment: AlignmentType.CENTER, spacing: { before: 120, after: 40 }, keepNext: true }),
    new Paragraph({ children: [new TextRun({ text: `Fig. ${figNo}. `, font: FONT, size: 16 }), ...runs(caption, { size: 16 })], alignment: AlignmentType.JUSTIFIED, spacing: { after: 140 } })
  ];
}
function pngSize(file) { const b = fs.readFileSync(file); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; }

const thin = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
function table(caption, header, rows, widths, opts = {}) {
  tabNo++;
  const total = widths.reduce((a, b) => a + b, 0);
  const cell = (text, i, isHeader, last) => new TableCell({
    width: { size: widths[i], type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER,
    margins: { top: 20, bottom: 20, left: 50, right: 50 },
    shading: isHeader ? { type: ShadingType.CLEAR, color: 'auto', fill: 'EDEDED' } : undefined,
    borders: { top: isHeader ? thin : none, bottom: (isHeader || last) ? thin : none, left: none, right: none },
    children: [new Paragraph({ children: runs(String(text), { size: 15, bold: isHeader }), alignment: i === 0 && !opts.centerFirst ? AlignmentType.LEFT : AlignmentType.CENTER })]
  });
  return [
    new Paragraph({ children: [new TextRun({ text: `TABLE ${roman[tabNo - 1]}`, font: FONT, size: 16 })], alignment: AlignmentType.CENTER, spacing: { before: 140, after: 0 }, keepNext: true }),
    new Paragraph({ children: [new TextRun({ text: caption, font: FONT, size: 16, smallCaps: true })], alignment: AlignmentType.CENTER, spacing: { after: 60 }, keepNext: true }),
    new Table({
      width: { size: total, type: WidthType.DXA }, columnWidths: widths, alignment: AlignmentType.CENTER,
      rows: [new TableRow({ tableHeader: true, children: header.map((t, i) => cell(t, i, true, false)) }),
        ...rows.map((r, ri) => new TableRow({ cantSplit: true, children: r.map((t, i) => cell(t, i, false, ri === rows.length - 1)) }))]
    }),
    ...(opts.note ? [new Paragraph({ children: runs(opts.note, { size: 14, italics: false }), spacing: { before: 30 }, alignment: AlignmentType.JUSTIFIED })] : []),
    new Paragraph({ children: [], spacing: { after: 100 } })
  ];
}

// ---------- content ----------
const t = ml.test, cm = t.confusion_matrix.matrix, base = ml.baseline_most_frequent;
const fi = Object.entries(ml.feature_importance);
const L = lat.results;

const titleSection = [
  new Paragraph({ children: [new TextRun({ text: 'ParkEase: A Cloud-Based Parking Reservation System with Machine Learning-Based Demand Prediction', font: FONT, size: 48 })], alignment: AlignmentType.CENTER, spacing: { after: 200 } }),
  new Paragraph({ children: [new TextRun({ text: '[Author Name 1], [Author Name 2], [Author Name 3]', font: FONT, size: 22 })], alignment: AlignmentType.CENTER }),
  new Paragraph({ children: [new TextRun({ text: '[Department], [College / University]', font: FONT, size: 20, italics: true })], alignment: AlignmentType.CENTER }),
  new Paragraph({ children: [new TextRun({ text: '[City, Country]  ·  [email@example.edu]', font: FONT, size: 20 })], alignment: AlignmentType.CENTER, spacing: { after: 280 } })
];

const abstract = [
  new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 80 }, children: [
    new TextRun({ text: 'Abstract', font: FONT, size: 18, bold: true, italics: true }), new TextRun({ text: '—', font: FONT, size: 18, bold: true }),
    ...runs(`Finding a parking space wastes time and fuel, and small parking operators rarely know when their lots will be full. This paper presents ParkEase, a web-based parking reservation system built with React, Node.js/Express and MongoDB Atlas, designed for serverless deployment on AWS Lambda and Amazon API Gateway. The system models each reserved hour of a parking spot as a separate document protected by unique compound indexes, and writes a booking together with its hourly segments in one multi-document ACID transaction. In an experiment with 50 concurrent clients over 20 rounds, a naive check-then-insert approach double-booked a spot in all 20 rounds, while the proposed design admitted exactly one booking per round. A compound index reduced the documents examined by the availability query from ${n(idx.collectionScan.totalDocsExamined)} to ${n(idx.indexScan.totalDocsExamined)}. A Random Forest classifier, trained with scikit-learn on a clearly labelled synthetic occupancy history, predicts low, medium or high demand per lot and hour; on a held-out later time period it reached ${pct(t.accuracy)} accuracy and ${t.macro_f1.toFixed(3)} macro F1, against ${pct(base.accuracy)} accuracy for a majority-class baseline. The model is exported to JSON and served inside the existing API with identical predictions, and is kept separate from booking validation. The estimated AWS cost for a demonstration workload is about US$0.03 per month. Limitations, chiefly the synthetic training data, are discussed.`, { size: 18, bold: true })
  ] }),
  new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 120 }, children: [
    new TextRun({ text: 'Index Terms', font: FONT, size: 18, bold: true, italics: true }), new TextRun({ text: '—', font: FONT, size: 18, bold: true }),
    new TextRun({ text: 'smart parking, reservation system, MongoDB, transactions, concurrency control, serverless computing, AWS Lambda, random forest, demand prediction.', font: FONT, size: 18, bold: true })
  ] })
];

const body1 = [
  ...abstract,
  H1('Introduction'),
  P('Drivers in busy areas spend a noticeable share of their trips searching for parking. Shoup estimated from a series of studies that cruising for curb parking accounts for a substantial share of traffic in congested downtowns [1], and surveys of smart-parking research show a steady move from sensor-only systems towards reservation and prediction services [2]. For a driver, the most useful guarantee is a reserved spot; for an operator, the most useful information is when demand will peak.'),
  P('ParkEase began as a student web application that let users browse parking lots and reserve spots. An inspection of the original code found a sound core (a transactional booking design) but also a fake spot map, static availability figures, short random booking references that could collide, no machine-learning component, and no automated tests. This paper describes how the system was completed into a working reservation platform that demonstrates three areas of a computer-science curriculum: database management, cloud computing and artificial intelligence.'),
  H2('Problem Statement'),
  P('A parking reservation service must never sell the same spot twice for overlapping times, even when many users book at the same moment; it must show availability that matches the database; it must remain cheap enough to run on student cloud credits (about US$140 of AWS credit and no personal spending); and any demand forecast must inform users without ever overriding the actual booking state.'),
  H2('Objectives'),
  numbered('Design a database schema whose constraints make overlapping and duplicate bookings impossible under concurrency, and demonstrate CRUD, indexing and aggregation.', 'obj'),
  numbered('Add a real machine-learning feature that predicts low, medium or high demand, evaluate it honestly and serve it through a secure API.', 'obj'),
  numbered('Design a low-cost serverless cloud deployment with monitoring, budget controls and secure configuration.', 'obj'),
  numbered('Verify the system with automated tests, including concurrent booking attempts, and report only measured results.', 'obj'),

  H1('Related Work'),
  P('Lin *et al.* survey smart-parking solutions across information collection, system deployment and service dissemination, and identify reservation and prediction as key services [2]. Zheng *et al.* predicted parking occupancy for sensor-enabled car parks in Melbourne and San Francisco and compared regression trees, neural networks and support vector regression, finding tree-based models competitive [3]. Random Forests, introduced by Breiman [4], are widely used for such tabular prediction because they capture non-linear interactions with little tuning; we use the scikit-learn implementation [5].'),
  P('On the database side, the classic treatment of transactions and isolation is given by Gray and Reuter [6], and Berenson *et al.* show how weak isolation levels admit anomalies such as lost updates and write skew [7]. Kung and Robinson proposed optimistic concurrency control, which validates conflicts at commit time rather than locking in advance [8]; the approach taken here follows that spirit, using unique indexes as the validation step. MongoDB supports multi-document ACID transactions with snapshot isolation on replica sets [9]. For deployment, serverless computing lets applications scale to zero and bill per request [10], which suits workloads with low and irregular traffic such as a student project.'),

  H1('System Architecture'),
  P('ParkEase has four parts (Fig. 1). A single-page React application is built with Vite and, in the AWS design, served from a private Amazon S3 bucket through Amazon CloudFront. The Express API contains authentication, parking-lot management, booking, administrative analytics and demand-prediction routes; it runs either as a long-lived Node.js process (locally and on the existing Render deployment) or as a single AWS Lambda function behind an API Gateway HTTP API using `serverless-http`. MongoDB Atlas stores all data. An offline Python pipeline trains the prediction model and exports it as a JSON file that is bundled with the API.')
];

const figArch = figure('docs/diagrams/architecture.png', TEXT_W, 'System architecture. Solid arrows are request paths; dashed arrows are the existing Render fallback, logging and the offline model pipeline. The AWS components are designed and templated but not yet deployed.');

const body2 = [
  P('The API is stateless: each request carries a JSON Web Token (JWT) and the user\'s role is re-read from the database on every request, so a role change takes effect immediately. This also allows any Lambda container to serve any request.'),

  H1('Database Design and DBMS Implementation'),
  H2('Schema'),
  P('The database has five collections (Fig. 2). `users`, `parkinglots` and `bookings` hold the main entities; bookings reference users and lots through `ObjectId` fields, playing the role of foreign keys. `bookingsegments` holds one document per reserved hour of a spot, and `parkingevents` is an audit log. The lot name is copied into each booking on purpose, as a historical snapshot for receipts. Spot identifiers (`A-01`, `A-02`, ...) are derived from a lot\'s capacity in rows of ten rather than stored, so they always match the capacity.')
];

const figER = figure('docs/diagrams/er.png', TEXT_W, 'Entity-relationship view of the MongoDB collections, with primary keys, references and the indexes that enforce integrity.');

const body3 = [
  H2('Preventing Overlapping and Duplicate Bookings'),
  P('A booking from 09:00 to 12:00 creates one `bookings` document and three `bookingsegments` documents for hours 9, 10 and 11. Two unique compound indexes on the segments express the business rules as database constraints: `(lotId, date, slot, hour)` forbids two reservations of the same spot in the same hour, which is exactly the condition for two bookings to overlap; and `(vehicleKey, date, hour)`, where `vehicleKey` is the normalised licence plate, forbids one vehicle from holding two spots at once and so blocks duplicate submissions. Booking references use six random base-32 characters per date, about one billion possibilities, and are also unique.'),
  P('The booking document and all its segments are inserted in one multi-document transaction (Fig. 3). If any segment violates a unique index the whole transaction aborts, so a partially stored booking cannot exist (atomicity). Under snapshot isolation, two transactions that write the same index key conflict; the loser receives a transient `WriteConflict`, the driver retries it, and on retry it sees the committed segment and fails with a duplicate-key error that the API returns as HTTP 409. Commits use majority write concern on Atlas for durability. Cancellation likewise runs in a transaction that marks the booking cancelled and deletes its segments.'),
  P('This is optimistic concurrency control in the sense of [8]: no locks are taken, and conflicts are detected at write time. It suits parking, where most concurrent requests target different spots. The common alternative, reading to check that a spot is free and then inserting, has a race window between the two steps; Section VII measures its effect.'),
  ...figure('docs/diagrams/booking-flow.png', COL_W - 400, 'Booking transaction. Validation happens before the transaction; the unique indexes decide conflicts inside it.'),
  H2('Other Integrity Rules'),
  P('Mongoose schemas and MongoDB `$jsonSchema` validators enforce required fields, types, enumerations and ranges at the database level. The API additionally rejects bookings that start in the past (computed in the parking network\'s configured time zone), more than 60 days ahead, or for a spot outside the lot. A lot\'s capacity cannot be reduced below a spot with upcoming bookings, lots are archived rather than deleted so that old bookings keep a valid reference, and bookings whose end time has passed are marked `Completed` before bookings are read.'),
  H2('CRUD, Indexing and Aggregation'),
  P('All four CRUD operations are exercised: users, lots, bookings and audit events are created; lots are listed, filtered and full-text searched; lots, profile names and booking status are updated; and segments are deleted on cancellation. Table I lists the indexes and the query each supports. Administrative figures are computed by aggregation pipelines: `$group` for totals by status and revenue, `$group` over segments for occupancy by hour of day, and `$lookup` (a join) from bookings to lots for revenue and average booking length per lot. An administrative endpoint returns the query plan of the availability query so that index use can be demonstrated live.'),
  ...table('Indexes and their purpose', ['Collection', 'Index', 'Purpose'], [
    ['users', 'email (unique)', 'login; one account per email'],
    ['parkinglots', '(area, active); text', 'filters; search'],
    ['bookings', 'reference (unique)', 'distinct references'],
    ['bookings', '(userId, createdAt)', 'booking history'],
    ['bookings', '(lotId, date, status)', 'upcoming bookings per lot'],
    ['segments', '(lotId, date, slot, hour) U', 'no overlapping bookings'],
    ['segments', '(vehicleKey, date, hour) U', 'one spot per vehicle'],
    ['segments', '(lotId, date, hour)', 'availability, live counts']
  ], [1150, 2150, 1740], { note: 'U = unique. "segments" = bookingsegments.' }),

  H1('Machine-Learning Demand Prediction'),
  H2('Task and Data'),
  P(`The model predicts, for a lot, date and hour, whether occupancy will be low (below 40%), medium (40% to below 75%) or high (75% or more). The thresholds are a design choice. Because the system is new, real bookings are far too few for training, so a simulator generates a **synthetic** history and every row is labelled as such. The simulator covers 12 lots (the six demonstration lots and six additional lots of other sizes and prices) for every hour of 2025, giving ${n(ml.data.rows_by_source.synthetic)} rows. Its assumptions are explicit: hourly weekday and weekend occupancy profiles per lot type (office, mall, transit, hospital, event), a small price effect, seasonal effects, a random per-day effect and per-hour noise, and a binomial draw of occupied spots. A script can export real hourly occupancy from MongoDB with an aggregation, so real data can be added to training as it accumulates.`),
  H2('Features and Training'),
  P(`Features are hour, day of week, a weekend flag, month, capacity, hourly price and a one-hot lot type. The lot identifier is deliberately excluded so the model applies to new lots. Data are split by time: training on ${ml.data.train_period[0]} to ${ml.data.train_period[1]} (${n(ml.data.train_rows)} rows) and testing on ${ml.data.test_period[0]} to ${ml.data.test_period[1]} (${n(ml.data.test_rows)} rows), because a random split would place near-identical neighbouring hours in both sets. A Random Forest with ${ml.model.n_estimators} trees and balanced class weights was tuned by grid search over maximum depth {8, 12, 16} and minimum leaf size {5, 20} with three-fold time-series cross-validation scored by macro F1; the best setting was depth ${ml.model.max_depth} and leaf size ${ml.model.min_samples_leaf} (cross-validated macro F1 ${ml.model.cv_macro_f1.toFixed(3)}).`),
  H2('Serving'),
  P('Running scikit-learn in production would require a separate Python function or a hosted model endpoint, adding cost. Instead, the training script exports each tree as arrays of split features, thresholds, child indices and leaf class probabilities (about 3.5 MB of JSON). The Node.js API walks each tree and averages the leaf probabilities, which is how a Random Forest computes class probabilities. A parity test on 300 held-out rows confirms that every predicted class matches scikit-learn and that probabilities differ by less than 0.0001. The prediction endpoint requires sign-in, validates its inputs and is rate-limited. It is never consulted when a booking is accepted or refused; the user interface labels it as a forecast and shows it beside, not instead of, live availability.'),

  H1('Cloud Deployment, Security and Cost'),
  H2('Deployment Design'),
  P('The AWS design (Fig. 1) uses one Lambda function (Node.js 22 on arm64, 512 MB) behind an API Gateway HTTP API with stage throttling of 10 requests per second and a burst of 20; a private S3 bucket and CloudFront with Origin Access Control and a managed security-headers policy; CloudWatch Logs with seven-day retention and an error alarm; and AWS Budgets email alerts. All resources are described in CloudFormation/SAM templates, which were validated with `cfn-lint`, so the whole deployment can be created and deleted as stacks. The Lambda handler connects to MongoDB once per container and reuses the connection across invocations. The previous Render deployment is preserved as a fallback.'),
  H2('Security'),
  P('Passwords are hashed with bcrypt (cost 12). JWTs are signed with HS256 and verified with the algorithm pinned, which rejects unsigned tokens. Administrator rights are assigned only on the server. Every request body and query is validated with schemas that strip unknown keys, which blocks NoSQL operator injection such as `{"$ne": null}`. The API sets security headers with Helmet, allows cross-origin requests only from configured frontend origins, limits sign-in attempts to 20 per 15 minutes per client, limits prediction requests, caps request bodies at 20 KB and returns generic error messages. Secrets exist only in environment variables. During inspection, the original project archive was found to contain a real database password and token secret; these were removed from the code base and their rotation was recommended.'),
  H2('Cost Analysis'),
  P('Table II estimates monthly cost for a demonstration load of 20,000 API calls of 300 ms each, using public AWS prices checked in October 2026 [11]-[13]. Lambda usage (3,000 GB-seconds) is inside the always-free monthly allowance of one million requests and 400,000 GB-seconds; the only billable item of note is API Gateway at US$1.00 per million requests. New AWS accounts now receive credits under a time-limited Free plan rather than the former 12-month free tier [14], and credits do not necessarily cover every charge, so the budget alert counts usage before credits are applied. The main financial risk is not this design but leaving costly resources (for example a NAT gateway or an always-on model endpoint) running; the guide therefore includes a clean-up procedure.'),
  ...table('Estimated monthly AWS cost (demonstration load)', ['Service', 'Basis', 'US$/month'], [
    ['Lambda (arm64)', 'within always-free allowance', '0.00'],
    ['API Gateway HTTP API', '20,000 × $1.00 per million', '≈ 0.02'],
    ['CloudFront', 'within 1 TB / 10M requests free', '0.00'],
    ['S3', '≈ 2 MB stored', '< 0.01'],
    ['CloudWatch Logs + 1 alarm', 'within 5 GB / 10 alarms free', '0.00'],
    ['AWS Budgets', 'alerts are free', '0.00'],
    ['MongoDB Atlas', 'free cluster (not AWS)', '0.00'],
    ['**Total**', '', '**≈ 0.03**']
  ], [1900, 2240, 900], { note: 'Estimate, not a measured bill. The AWS deployment has not yet been performed.' }),

  H1('Testing and Results'),
  P('All results in this section were measured on 23 October 2026 on a four-vCPU Linux container using MongoDB 7.0 in Docker as a single-node replica set. None were measured on MongoDB Atlas or AWS; those tests are listed as future work.'),
  H2('Functional and Security Tests'),
  P('An automated suite of 51 tests in four groups (unit, API, concurrency and rate limiting) runs against a real replica set; all 51 passed, and the concurrency group passed in three further repeated runs. Table III summarises coverage. A browser test using Playwright additionally registered a user, made a booking, confirmed that the spot then appeared as booked, and opened the administrator dashboard without console errors.'),
  ...table('Automated test coverage (51 tests, all passed)', ['Area', 'Examples of checks'], [
    ['Authentication', 'validation, duplicate email, equal response for wrong password and unknown email'],
    ['Tokens & roles', 'missing, forged, alg=none and expired JWTs rejected; 401/403 on admin routes'],
    ['Input & errors', 'operator injection, bad ids, malformed and oversized JSON, impossible dates'],
    ['Bookings', 'overlap refused, back-to-back allowed, one spot per vehicle, cancel rules'],
    ['Concurrency', '30 simultaneous requests: exactly one success for one spot'],
    ['DBMS', 'aggregation totals consistent; availability query uses an index'],
    ['AI', 'auth required, 24 hourly outputs, parity with scikit-learn, no effect on availability'],
    ['Platform', 'security headers, CORS allow-list, sign-in rate limit']
  ], [1350, 3690]),
  H2('Concurrency Experiment'),
  P(`In each of ${race.rounds} rounds, ${race.clients} clients attempted at the same moment to reserve the same spot and hour (Table IV). With check-then-insert, every round produced multiple "successful" bookings, up to ${race.naive.maxWinners} in one round. With unique indexes inside transactions, every round produced exactly one booking and no orphaned booking documents.`),
  ...table('Concurrent booking experiment', ['Approach', 'Rounds double-booked', 'Max winners', 'Total winners'], [
    ['Check then insert', `${race.naive.roundsWithDoubleBooking} / ${race.rounds}`, race.naive.maxWinners, race.naive.totalWinners],
    ['ParkEase design', `${race.parkease.roundsWithDoubleBooking} / ${race.rounds}`, race.parkease.maxWinners, race.parkease.totalWinners]
  ], [1640, 1300, 1000, 1100], { note: `Ideal total winners = ${race.rounds} (one per round).` }),
  H2('Index Experiment'),
  P(`The availability query was run over ${n(idx.segments)} synthetic segments with a forced collection scan and with the \`(lotId, date, hour)\` index (Table V; median of five runs, timings from MongoDB execution statistics).`),
  ...table('Availability query with and without an index', ['Plan', 'Docs examined', 'Keys examined', 'Median time'], [
    ['Collection scan', n(idx.collectionScan.totalDocsExamined), n(idx.collectionScan.totalKeysExamined), `${idx.collectionScan.medianTimeMs} ms`],
    ['Index scan', n(idx.indexScan.totalDocsExamined), n(idx.indexScan.totalKeysExamined), '< 1 ms']
  ], [1500, 1220, 1220, 1100], { note: `Both plans returned ${idx.indexScan.nReturned} documents.` }),
  H2('Model Evaluation'),
  P(`Table VI and Fig. 4 report results on the held-out test period. The forest reached ${pct(t.accuracy)} accuracy and ${t.macro_f1.toFixed(3)} macro F1, compared with ${pct(base.accuracy)} accuracy and ${base.macro_f1.toFixed(3)} macro F1 for always predicting the most frequent class. Errors occur almost only between adjacent classes; low and high demand were never confused. Medium demand is hardest (F1 ${t.per_class.medium['f1-score'].toFixed(3)}) because it is a narrow band whose hours are pushed across both thresholds by the simulated daily variation. Hour of day dominates the feature importances (${fi[0][1].toFixed(2)}), followed by day of week (${fi[1][1].toFixed(2)}) (Fig. 5). Because the data are synthetic, these figures show that the model recovers the simulated patterns; they are not evidence of real-world accuracy.`),
  ...table('Demand model results on the test period', ['Class / model', 'Precision', 'Recall', 'F1', 'Support'], [
    ...['low', 'medium', 'high'].map(c => [c, t.per_class[c].precision.toFixed(3), t.per_class[c].recall.toFixed(3), t.per_class[c]['f1-score'].toFixed(3), n(t.per_class[c].support)]),
    ['Random Forest (macro)', '', '', t.macro_f1.toFixed(3), `acc. ${pct(t.accuracy)}`],
    ['Majority baseline (macro)', '', '', base.macro_f1.toFixed(3), `acc. ${pct(base.accuracy)}`]
  ], [1640, 850, 800, 800, 950]),
  ...figure('docs/diagrams/confusion_matrix.png', COL_W - 1300, `Confusion matrix on the test period (rows actual, columns predicted). Diagonal: ${n(cm[0][0])}, ${n(cm[1][1])} and ${n(cm[2][2])} correct.`),
  ...figure('docs/diagrams/feature_importance.png', COL_W - 500, 'Random Forest feature importance (mean decrease in impurity).'),
  H2('Latency'),
  P(`Table VII gives API latencies measured locally over 100 sequential calls per endpoint (rate limiting disabled for the measurement). A 24-hour forecast took ${L['GET /predictions/demand (24 h)'].p50} ms at the median, and a transactional booking ${L['POST /bookings (transaction)'].p50} ms. Cloud latencies, including Lambda cold starts and the network path to Atlas, will be higher and have not been measured.`),
  ...table('Local API latency (ms)', ['Endpoint', 'p50', 'p95'], Object.entries(L).map(([k, v]) => [k.replace(' (transaction)', ' (txn)'), v.p50, v.p95]), [3240, 900, 900]),

  H1('Limitations and Future Enhancements'),
  bullet('The demand model is trained only on synthetic data; its real-world accuracy is unknown. Retraining on exported real occupancy is the most important next step.'),
  bullet('Features omit holidays, weather, local events and recent booking trends.'),
  bullet('The AWS deployment, and tests against Atlas and the cloud deployment, have been designed but not yet performed.'),
  bullet('Bookings use whole hours, and payment is not integrated.'),
  bullet('Application rate limits are per server instance; on AWS they are backed by API Gateway throttling.'),
  P('Future work includes retraining with real data and drift monitoring, comparing gradient-boosted models, sensor or camera integration for occupancy, online payment, and demand-aware pricing.', { noIndent: false }),

  H1('Conclusion'),
  P('ParkEase shows that a small team can build a reservation system whose central guarantee, no double booking, is enforced by the database itself rather than by application checks. Modelling reserved hours as uniquely indexed documents written in a single transaction admitted exactly one booking in every round of a concurrency experiment in which a naive approach failed every round. A Random Forest demand forecast was integrated without new infrastructure by exporting the model to JSON, and is kept strictly separate from booking validation. A serverless AWS design keeps the expected cost of a demonstration deployment to a few cents per month. The main open item is to replace synthetic training data with real occupancy history.')
];

const refs = [
  'D. C. Shoup, "Cruising for parking," *Transport Policy*, vol. 13, no. 6, pp. 479–486, 2006, doi: 10.1016/j.tranpol.2006.05.005.',
  'T. Lin, H. Rivano, and F. Le Mouël, "A survey of smart parking solutions," *IEEE Trans. Intell. Transp. Syst.*, vol. 18, no. 12, pp. 3229–3253, Dec. 2017, doi: 10.1109/TITS.2017.2685143.',
  'Y. Zheng, S. Rajasegarar, and C. Leckie, "Parking availability prediction for sensor-enabled car parks in smart cities," in *Proc. IEEE 10th Int. Conf. Intelligent Sensors, Sensor Networks and Information Processing (ISSNIP)*, Singapore, 2015, pp. 1–6.',
  'L. Breiman, "Random forests," *Machine Learning*, vol. 45, no. 1, pp. 5–32, 2001, doi: 10.1023/A:1010933404324.',
  'F. Pedregosa *et al.*, "Scikit-learn: Machine learning in Python," *J. Mach. Learn. Res.*, vol. 12, pp. 2825–2830, 2011.',
  'J. Gray and A. Reuter, *Transaction Processing: Concepts and Techniques*. San Francisco, CA, USA: Morgan Kaufmann, 1993.',
  'H. Berenson, P. Bernstein, J. Gray, J. Melton, E. O\'Neil, and P. O\'Neil, "A critique of ANSI SQL isolation levels," in *Proc. ACM SIGMOD Int. Conf. Management of Data*, 1995, pp. 1–10.',
  'H. T. Kung and J. T. Robinson, "On optimistic methods for concurrency control," *ACM Trans. Database Syst.*, vol. 6, no. 2, pp. 213–226, 1981, doi: 10.1145/319566.319567.',
  'MongoDB, Inc., "Transactions," MongoDB Manual. [Online]. Available: https://www.mongodb.com/docs/manual/core/transactions/ (accessed Oct. 23, 2026).',
  'E. Jonas *et al.*, "Cloud programming simplified: A Berkeley view on serverless computing," Univ. California, Berkeley, Tech. Rep. UCB/EECS-2019-3, 2019.',
  'Amazon Web Services, "Amazon API Gateway pricing." [Online]. Available: https://aws.amazon.com/api-gateway/pricing/ (accessed Oct. 23, 2026).',
  'Amazon Web Services, "Amazon CloudFront pricing." [Online]. Available: https://aws.amazon.com/cloudfront/pricing/ (accessed Oct. 23, 2026).',
  'Amazon Web Services, "Amazon CloudWatch pricing." [Online]. Available: https://aws.amazon.com/cloudwatch/pricing/ (accessed Oct. 23, 2026).',
  'Amazon Web Services, "AWS Free Tier update: New customers can get started and explore AWS with up to $200 in credits," AWS News Blog, Jul. 2025. [Online]. Available: https://aws.amazon.com/blogs/aws/aws-free-tier-update-new-customers-can-get-started-and-explore-aws-with-up-to-200-in-credits'
];
const references = [
  new Paragraph({ children: [new TextRun({ text: 'References', font: FONT, size: 20, smallCaps: true })], alignment: AlignmentType.CENTER, spacing: { before: 160, after: 80 }, keepNext: true }),
  ...refs.map((r, i) => new Paragraph({ children: [new TextRun({ text: `[${i + 1}]\t`, font: FONT, size: 16 }), ...runs(r, { size: 16 })], indent: { left: 360, hanging: 360 }, tabStops: [{ type: 'left', position: 360 }], alignment: AlignmentType.JUSTIFIED, spacing: { after: 30 } }))
];

// ---------- document ----------
const page = { size: PAGE, margin: MARGIN };
const twoCol = { space: COL_SPACE, count: 2, equalWidth: true };
const footer = new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16 })] })] });
const sec = (children, cols, first) => ({ properties: { page, column: cols ? twoCol : { count: 1 }, type: first ? undefined : SectionType.CONTINUOUS }, footers: { default: footer }, children });

const doc = new Document({
  creator: 'ParkEase project team', title: 'ParkEase: A Cloud-Based Parking Reservation System with Machine Learning-Based Demand Prediction',
  styles: { default: { document: { run: { font: FONT, size: 20 } } } },
  numbering: { config: [
    { reference: 'bullets', levels: [{ level: 0, format: 'bullet', text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 245, hanging: 160 } } } }] },
    { reference: 'obj', levels: [{ level: 0, format: 'decimal', text: '%1)', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 300, hanging: 220 } } } }] }
  ] },
  sections: [
    sec(titleSection, false, true),
    sec(body1, true),
    sec(figArch, false),
    sec(body2, true),
    sec(figER, false),
    sec([...body3, ...references], true)
  ]
});

Packer.toBuffer(doc).then(buf => {
  const out = path.join(__dirname, 'ParkEase-IEEE-paper.docx');
  fs.writeFileSync(out, buf);
  console.log('Wrote', out);
});
