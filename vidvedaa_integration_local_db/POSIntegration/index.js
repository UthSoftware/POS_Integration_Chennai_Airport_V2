require('dotenv').config();
const cron = require('node-cron');
const dataFetcher = require('./src/services/dataFetcher');
const logger = require('./src/config/logger');
const fs = require('fs').promises;
const path = require('path');

async function ensureDirectories() {
  const logsDir = path.join(__dirname, '../logs');
  const configDir = path.join(__dirname, '../config');
  
  try {
    await fs.mkdir(logsDir, { recursive: true });
    await fs.mkdir(configDir, { recursive: true });
    logger.info('Directories ensured');
  } catch (error) {
    console.error('Error creating directories:', error);
  }
}

async function runFetchCycle() {
  try {
    logger.info('=== Starting scheduled fetch cycle ===');
    await dataFetcher.fetchAndPost();
    logger.info('=== Fetch cycle completed ===');
  } catch (error) {
    logger.error('Fetch cycle error', { error: error.message });
  }
}

async function startScheduler() {
  const intervalMinutes = parseInt(process.env.FETCH_INTERVAL_MINUTES) || 15;
  const cronExpression = `*/${intervalMinutes} * * * *`;
  
  logger.info('Starting scheduler', { 
    interval: `${intervalMinutes} minutes`,
    cronExpression 
  });
  
  cron.schedule(cronExpression, runFetchCycle);
  
  logger.info('Running initial fetch cycle...');
  await runFetchCycle();
}

async function runOnce() {
  logger.info('Running in one-time mode');
  await runFetchCycle();
  process.exit(0);
}

async function main() {
  await ensureDirectories();
  
  logger.info('Vendor DB Fetcher starting...', {
    cloudApiUrl: process.env.CLOUD_API_URL,
    schedulerEnabled: process.env.ENABLE_SCHEDULER === 'true'
  });
  
  if (process.env.ENABLE_SCHEDULER === 'true') {
    await startScheduler();
  } else {
    await runOnce();
  }
}

process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down gracefully');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', { reason, promise });
});

main().catch(error => {
  logger.error('Application startup failed', { error: error.message });
  process.exit(1);
});