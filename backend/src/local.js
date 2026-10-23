// Long-running server entry point, used locally and on Render.
require('dotenv').config();
const app = require('./app');
const { connectDatabase } = require('./db');

const port = process.env.PORT || 4001;
connectDatabase()
  .then(() => app.listen(port, () => console.log(`ParkEase API listening at http://localhost:${port}`)))
  .catch(err => { console.error(err.message); process.exit(1); });
