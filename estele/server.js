const express = require('express');
const DataFetcher = require('./src/services/dataFetcher');
const logger = require('./src/config/logger');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'Vendor Data Fetcher'
  });
});

// Main tally endpoint - fetches data dynamically
app.get('/tally', async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;

    // Validate parameters
    if (!fromDate || !toDate) {
      logger.warn('Missing date parameters in request');
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: fromDate and toDate',
        example: '/tally?fromDate=20260105&toDate=20260105',
        format: 'YYYYMMDD'
      });
    }

    // Validate date format (YYYYMMDD)
    if (!/^\d{8}$/.test(fromDate) || !/^\d{8}$/.test(toDate)) {
      logger.warn('Invalid date format', { fromDate, toDate });
      return res.status(400).json({
        success: false,
        error: 'Invalid date format. Expected YYYYMMDD',
        example: 'fromDate=20260105',
        received: { fromDate, toDate }
      });
    }

    // Convert date format from YYYYMMDD to YYYY-MM-DDTHH:mm:ss
    const formattedFromDate = formatDate(fromDate, '00:00:00');
    const formattedToDate = formatDate(toDate, '23:59:59');

    logger.info('Tally request received', {
      fromDate: formattedFromDate,
      toDate: formattedToDate,
      originalFromDate: fromDate,
      originalToDate: toDate,
      ip: req.ip
    });

    // Set environment variables for this request
    process.env.FROM_DATE = formattedFromDate;
    process.env.TO_DATE = formattedToDate;

    // Fetch and post data
    const result = await DataFetcher.fetchAndPost();

    logger.info('Tally request completed successfully', {
      fromDate: formattedFromDate,
      toDate: formattedToDate,
      recordCount: result.recordCount
    });

    res.json({
      success: true,
      message: 'Data fetched and posted successfully',
      fromDate: formattedFromDate,
      toDate: formattedToDate,
      recordCount: result.recordCount,
      postStatus: result.postResult?.status,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Tally endpoint error', {
      error: error.message,
      stack: error.stack,
      query: req.query
    });

    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    availableEndpoints: [
      'GET /health',
      'GET /tally?fromDate=YYYYMMDD&toDate=YYYYMMDD'
    ]
  });
});

// Global error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    url: req.url
  });

  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: err.message
  });
});

// Start server
app.listen(PORT, () => {
  logger.info(`Server started successfully`, { port: PORT });
  console.log('\n' + '='.repeat(80));
  console.log('🚀 Vendor Data Fetcher Server Started');
  console.log('='.repeat(80));
  console.log(`📍 Server URL: http://localhost:${PORT}`);
  console.log(`💚 Health Check: http://localhost:${PORT}/health`);
  console.log(`📊 Tally Endpoint: http://localhost:${PORT}/tally?fromDate=20260105&toDate=20260105`);
  console.log('='.repeat(80) + '\n');
});

// Helper function to convert YYYYMMDD to YYYY-MM-DDTHH:mm:ss
function formatDate(dateStr, time) {
  if (!dateStr || dateStr.length !== 8) {
    throw new Error(`Invalid date format: ${dateStr}. Expected YYYYMMDD`);
  }

  const year = dateStr.substring(0, 4);
  const month = dateStr.substring(4, 6);
  const day = dateStr.substring(6, 8);

  // Validate month and day ranges
  const monthNum = parseInt(month);
  const dayNum = parseInt(day);

  if (monthNum < 1 || monthNum > 12) {
    throw new Error(`Invalid month: ${month}. Must be between 01-12`);
  }

  if (dayNum < 1 || dayNum > 31) {
    throw new Error(`Invalid day: ${day}. Must be between 01-31`);
  }

  return `${year}-${month}-${day}T${time}`;
}

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down gracefully');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

module.exports = app;