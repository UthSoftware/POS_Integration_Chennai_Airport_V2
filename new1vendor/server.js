require('dotenv').config();
const express = require('express');
const dataFetcher = require('./src/services/dataFetcher');
const logger = require('./src/config/logger');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());

// Health Check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'new1vendor SOAP-Cloud Integration Service',
    mode: process.env.DATA_SOURCE_MODE || 'mock',
    cloudApiUrl: process.env.CLOUD_API_URL,
    timestamp: new Date().toISOString()
  });
});

// View Sample Receipts
app.get('/sample', async (req, res) => {
  try {
    const data = await dataFetcher.loadMockData();
    res.json({
      success: true,
      count: data.length,
      sampleReceipts: data
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Trigger Fetch and Cloud Ingest
app.all(['/fetch', '/tally'], async (req, res) => {
  try {
    const query = req.query || {};
    const body = req.body || {};

    const mode = query.mode || body.mode || process.env.DATA_SOURCE_MODE || 'mock';
    const fromDate = query.fromDate || body.fromDate;
    const toDate = query.toDate || body.toDate;

    logger.info('HTTP trigger received for fetch and post', { mode, fromDate, toDate, ip: req.ip });

    const result = await dataFetcher.fetchAndPost({
      mode,
      fromDate,
      toDate
    });

    res.json({
      success: true,
      message: 'Fetch and post cycle executed successfully',
      mode,
      recordCount: result.recordCount,
      postStatus: result.postResult?.status,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('HTTP fetch endpoint error', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    endpoints: [
      'GET /health',
      'GET /sample',
      'GET /fetch?mode=mock|live|auto&fromDate=YYYY-MM-DDTHH:mm:ss&toDate=YYYY-MM-DDTHH:mm:ss'
    ]
  });
});

app.listen(PORT, () => {
  logger.info(`new1vendor Server listening on port ${PORT}`);
  console.log('\n' + '='.repeat(80));
  console.log('🚀 new1vendor SOAP-to-Cloud Service Server Running');
  console.log('='.repeat(80));
  console.log(`📍 Base URL:       http://localhost:${PORT}`);
  console.log(`💚 Health Check:   http://localhost:${PORT}/health`);
  console.log(`📦 Sample Data:    http://localhost:${PORT}/sample`);
  console.log(`⚡ Trigger Fetch:  http://localhost:${PORT}/fetch?mode=mock`);
  console.log('='.repeat(80) + '\n');
});

module.exports = app;
