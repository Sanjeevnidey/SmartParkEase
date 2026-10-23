# ParkEase

A cloud-based parking reservation system with machine-learning demand prediction. It was built as a college project to show DBMS, cloud computing and AI concepts in one working application.

- **Frontend:** React 18 + Vite (`frontend/`)
- **Backend:** Node.js 22 + Express 4 + Mongoose 8 (`backend/`), runs as a normal server (local, Render) or as one AWS Lambda function
- **Database:** MongoDB Atlas (a replica set, needed for multi-document transactions)
- **ML:** Python + scikit-learn Random Forest (`ml/`), exported to JSON and evaluated inside the Node API
- **Cloud:** AWS templates in `infra/` (Lambda + API Gateway HTTP API, S3 + CloudFront, CloudWatch, Budgets). The Render deployment still works.

![Architecture](docs/diagrams/architecture.png)

## Features

| Area | What it does |
|---|---|
| Accounts | Register, sign in (JWT, bcrypt), edit name, roles `customer` / `admin` (admin is assigned only on the server) |
| Parking lots | List, filter, full-text search, live "free now" count; admins create, edit, archive (soft delete) |
| Reservations | Live spot map per hour range, booking with a unique reference, history, cancellation before start, automatic `Completed` status |
| Integrity | No spot can be booked twice for the same hour and no vehicle can hold two spots at once, enforced by unique indexes inside transactions (tested with 30 simultaneous requests) |
| Admin | Totals by status, revenue, cancellation rate, 7-day chart, hourly occupancy, revenue per lot (`$lookup`), audit log, query-plan (`explain`) endpoint |
| AI | Low / medium / high demand forecast for each hour at a lot, shown next to (never instead of) live availability |
| Security | helmet headers, rate limits, zod validation, strict CORS, JWT algorithm pinning, generic errors, secrets only in environment variables |

## Quick start (local)

Requirements: Node.js 20+, Docker (for a local MongoDB replica set) or an Atlas connection string, Python 3.12+ only if you want to retrain the model.

```bash
# 1. Database: a single-node replica set (transactions need a replica set)
docker run -d --name parkease-mongo -p 27017:27017 mongo:7 --replSet rs0 --bind_ip_all
docker exec parkease-mongo mongosh --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"localhost:27017"}]})'

# 2. API
cd backend
cp .env.example .env      # then edit: MONGODB_URI, JWT_SECRET (32+ chars), ADMIN_EMAIL, ADMIN_PASSWORD (12+ chars)
npm install
npm run db:init           # builds indexes and adds $jsonSchema validators
npm run seed              # 6 sample lots + the admin account
npm run dev               # http://localhost:4001/api/health

# 3. Frontend (new terminal)
cd frontend
npm install
npm run dev               # http://localhost:5173
```

For a local database use `MONGODB_URI=mongodb://127.0.0.1:27017/parkease?replicaSet=rs0&directConnection=true`.

## Tests

```bash
cd backend
MONGODB_URI_TEST='mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true' npm test
```

51 tests in 4 suites (unit, API, concurrency, rate limit). Latest run: all passed, see [docs/results/test-output.txt](docs/results/test-output.txt) and [docs/TESTING.md](docs/TESTING.md). A browser smoke test is in `e2e/smoke.cjs`. GitHub Actions runs the backend tests, the frontend build and the ML pipeline on every push (`.github/workflows/ci.yml`).

## Machine learning

```bash
cd ml
pip install -r requirements.txt
python generate_synthetic.py      # SYNTHETIC history, clearly labelled
python train.py                   # trains, evaluates, writes backend/src/ml/demand-model.json
```

The current model was trained on 105,120 synthetic rows only. On the held-out last two months it scores 86.2% accuracy and 0.799 macro F1, against 63.3% for always predicting "low". These numbers show the model learns the simulated patterns, not real-world accuracy. Details: [docs/ML.md](docs/ML.md).

## Deployment

- **Render (existing):** build `npm install`, start `npm start` in `backend/`, set the environment variables from `.env.example`. Frontend: build with `VITE_API_BASE_URL=https://<service>.onrender.com/api`.
- **AWS (recommended, needs your approval before creating anything):** [docs/AWS_DEPLOYMENT.md](docs/AWS_DEPLOYMENT.md), including cost estimate, budget alerts, validation and clean-up.

## Documentation

| Document | Contents |
|---|---|
| [docs/DATABASE.md](docs/DATABASE.md) | Schema, ER diagram, indexes, constraints, transactions, aggregation examples, experiments |
| [docs/ML.md](docs/ML.md) | Dataset, features, training, evaluation, inference, limitations |
| [docs/AWS_DEPLOYMENT.md](docs/AWS_DEPLOYMENT.md) | AWS architecture, costs, step-by-step deploy, monitoring, clean-up |
| [docs/TESTING.md](docs/TESTING.md) | What is tested, results, what was not tested |
| [docs/VIVA_GUIDE.md](docs/VIVA_GUIDE.md) | Demo script and likely viva questions |
| [docs/API.md](docs/API.md) | All API routes |

## Project structure

```
backend/   Express API (src/routes, src/lib, src/ml), scripts (seed, db-init, experiments), tests
frontend/  React app (src/App.jsx, src/api.js, src/styles.css)
ml/        Synthetic data generator, training script, reports
infra/     AWS CloudFormation / SAM templates
docs/      Documentation, diagrams, measured results
e2e/       Browser smoke test (Playwright)
```

## Security notes

- Never commit or zip `backend/.env`. It is git-ignored; `.env.example` lists the variables.
- If a real `.env` was ever shared, rotate the Atlas password, `JWT_SECRET` and admin password.
- In Atlas, give the app user `readWrite` on its own database only. Lambda and Render free plans have no fixed outbound IP, so the Atlas IP list usually has to be `0.0.0.0/0`; the strong password and TLS are then the protection. A fixed IP needs a NAT Gateway (about $32/month), which this project avoids.
