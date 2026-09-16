require('dotenv').config();
const cron = require('node-cron');
const dataFetcher = require('./src/services/dataFetcher');
const logger = require('./src/config/logger');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};

  if (args.includes('--mock')) options.mode = 'mock';
  if (args.includes('--live')) options.mode = 'live';
  if (args.includes('--auto')) options.mode = 'auto';
  if (args.includes('--once')) options.once = true;

  return options;
}

async function runCycle(options = {}) {
  try {
    logger.info('=== Starting Scheduled/Manual Fetch Cycle ===');
    const result = await dataFetcher.fetchAndPost(options);
    logger.info(`=== Fetch Cycle Complete (${result.recordCount} receipts processed) ===`);
    return result;
  } catch (error) {
    logger.error('Fetch Cycle Encountered an Error', { error: error.message });
    throw error;
  }
}

async function startScheduler(options = {}) {
  const intervalMinutes = parseInt(process.env.FETCH_INTERVAL_MINUTES) || 15;
  const cronExpression = `*/${intervalMinutes} * * * *`;

  logger.info('Starting Background Scheduler', {
    interval: `${intervalMinutes} minutes`,
    cronExpression,
    mode: options.mode || process.env.DATA_SOURCE_MODE || 'mock'
  });

  cron.schedule(cronExpression, async () => {
    try {
      await runCycle(options);
    } catch (err) {
      logger.error('Scheduled cycle error', { message: err.message });
    }
  });

  logger.info('Executing initial fetch cycle on startup...');
  await runCycle(options);
}

async function main() {
  const options = parseArgs();
  const isScheduler = !options.once && process.env.ENABLE_SCHEDULER === 'true';

  logger.info('new1vendor Service Initializing...', {
    cloudApiUrl: process.env.CLOUD_API_URL,
    vendorId: process.env.VENDOR_ID,
    mode: options.mode || process.env.DATA_SOURCE_MODE || 'mock',
    schedulerEnabled: isScheduler
  });

  if (isScheduler) {
    await startScheduler(options);
  } else {
    logger.info('Running in one-time execution mode (--once)');
    await runCycle(options);
    process.exit(0);
  }
}

process.on('SIGINT', () => {
  logger.info('Received SIGINT. Shutting down gracefully.');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM. Shutting down gracefully.');
  process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at Promise', { reason });
});

main().catch(err => {
  logger.error('Fatal startup error', { message: err.message });
  process.exit(1);
});
