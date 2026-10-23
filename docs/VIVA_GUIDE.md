# ParkEase: presentation and viva guide

## 1. The 60-second pitch

ParkEase lets drivers find a parking lot, see which spots are free for the hours they need, and reserve one. Under the hood it shows three things: a database design that makes double booking impossible even when many people click at once; a cloud design that costs almost nothing when idle; and a machine-learning model that forecasts how busy a lot will be, kept separate from real availability.

## 2. Suggested slide order (10 to 12 minutes)

1. Problem: drivers circle for parking; operators cannot see demand. Objectives.
2. Architecture diagram (`docs/diagrams/architecture.png`).
3. ER diagram (`docs/diagrams/er.png`): 5 collections and their references.
4. The double-booking problem: why "check then insert" fails (race experiment: 20/20 rounds double-booked).
5. Our solution: hourly segments + unique index + transaction (`booking-flow.png`), and the result (0/20).
6. Indexing: availability query 200,000 docs scanned vs 38 with the index.
7. Aggregations: admin dashboard, `$group`, `$lookup`.
8. ML: data (synthetic, labelled), features, Random Forest, time-based split.
9. ML results: confusion matrix, 86.2% vs 63.3% baseline, honest limitation.
10. Cloud: Lambda + HTTP API + S3/CloudFront + Atlas; cost table (about $0.03/month).
11. Security and testing: 51 automated tests, what they cover.
12. Limitations and future work. Live demo.

## 3. Live demo script (5 minutes)

1. Open the app, go to **Find parking**. Point out "spots free" is live from the database.
2. Sign up as a new user. Open a lot. Show **Predicted demand** bars and say: this is the ML forecast; it does not decide availability.
3. Pick a time and a spot, enter a plate, confirm. Show the ticket and **My bookings**.
4. Open the same lot and time in a second browser (or incognito) as another user: the spot is greyed out. Try the same plate on another spot: refused ("vehicle already has a booking").
5. Sign in as admin. Show totals, 7-day chart, model card. Optionally open `/api/admin/db/explain` to show `indexUsed: lot_date_hour`.
6. If time: run `npm test` and show `51 passed`, or `node scripts/race-demo.js 50 5`.

Have a fallback: screenshots in `/screenshots` and the recorded test output in `docs/results/` in case the network fails.

## 4. Likely questions and short answers

**DBMS**

- *Why MongoDB and not MySQL?* The original project already used MongoDB Atlas, which has a free cloud tier and supports ACID multi-document transactions on replica sets. The design applies the same ideas as SQL: entities, references (foreign keys), unique constraints, transactions, indexes, joins (`$lookup`).
- *How do you prevent double booking?* Each booked hour is a document in `bookingsegments` with a unique index on (lot, date, spot, hour). The booking and its hours are inserted in one transaction. If any hour is taken, the index rejects it and the whole transaction rolls back.
- *Why not just check if the spot is free first?* Two requests can both check before either inserts. Our experiment: 50 parallel clients, naive approach double-booked in all 20 rounds.
- *Is it optimistic or pessimistic concurrency control?* Optimistic. No locks are taken; conflicts are detected at write time by the unique index and MongoDB's write-conflict detection, and transient conflicts are retried.
- *What are ACID properties here?* Atomic: booking + all segments or nothing. Consistent: unique indexes and schema validators. Isolated: snapshot isolation in transactions. Durable: majority write concern on Atlas.
- *Normalisation?* Users, lots and bookings are separate collections referenced by id (like 3NF). `lotName` is copied into bookings on purpose, as a historical snapshot for receipts.
- *Why soft delete lots?* So old bookings still point to an existing lot (referential integrity), and history and revenue reports stay correct.
- *Show an index being used.* `GET /api/admin/db/explain` or `db.bookingsegments.find({...}).explain('executionStats')`.

**AI/ML**

- *Why Random Forest?* Works well on small tabular data, handles non-linear patterns (hour × day × lot type) without feature scaling, gives class probabilities, and is easy to explain via feature importance.
- *Why synthetic data?* The system is new, so there are too few real bookings. The data is generated from written assumptions and labelled synthetic everywhere. The pipeline already supports adding real exported data.
- *So is 86% accuracy meaningful?* It shows the model learns the simulated patterns well and beats a trivial baseline (63.3%) by a large margin, especially on macro F1 (0.80 vs 0.26). It does not prove real-world accuracy; that needs real data.
- *Why a time-based split?* Neighbouring hours are similar; a random split would leak near-duplicates into the test set and inflate scores. Testing on later months mimics real use.
- *Why macro F1?* Classes are imbalanced (63% low); accuracy alone rewards predicting "low". Macro F1 weights each class equally.
- *How does Python model run in Node?* The trained trees are exported as arrays and walked in JavaScript; a test proves it gives the same predictions as scikit-learn on 300 rows.
- *Can the prediction block a booking?* No. Availability and booking validity come only from the database.

**Cloud**

- *Why serverless?* Pay per request, scales to zero, no server to patch. For a demo with little traffic it stays within free allowances.
- *What does it cost?* Estimated about $0.03 per month at 20,000 requests; budget alerts at $1 and $4 of a $5 monthly budget.
- *What is a cold start?* The first request to a new Lambda container loads code and connects to MongoDB, so it is slower; later requests reuse the connection.
- *How are secrets handled?* Never in code or git; environment variables (Render settings, Lambda parameters marked NoEcho).
- *Why keep Render?* It already worked and is a fallback if AWS credits run out.

**Security**

- Passwords hashed with bcrypt (cost 12); JWT signed with HS256 and the algorithm pinned on verify; admin role only set on the server and re-read from the database on every request; zod validation strips unexpected keys (stops NoSQL operator injection); rate limits; helmet headers; CORS allow-list.

## 5. Honest limitations to state yourself

- ML trained only on synthetic data.
- No real payment integration; amounts are shown only.
- Bookings use whole hours.
- In-memory rate limits are per server instance (API Gateway throttling covers the whole API on AWS).
- Cloud deployment and Atlas tests are pending the owner's approval and credentials.
