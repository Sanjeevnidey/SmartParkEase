// AWS Lambda entry point (API Gateway HTTP API -> Lambda). See docs/AWS_DEPLOYMENT.md.
require('dotenv').config();
const serverless = require('serverless-http');
const app = require('./app');
const { connectDatabase } = require('./db');

const handlerApp = serverless(app);
module.exports.handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  await connectDatabase();
  return handlerApp(event, context);
};
