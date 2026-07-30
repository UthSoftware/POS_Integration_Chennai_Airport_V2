const express = require('express');
const { body, validationResult } = require('express-validator');
const { processVendorDataDirect } = require('../../services/DirectProcessor'); // your new direct processor
const createLogger = require('../../config/logger');
const logger = createLogger('vendor-api');

const router = express.Router();

// Validation middleware
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn('Validation failed', { errors: errors.array() });
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  next();
};

// ================= POST /vendor-data/ingest =================
router.post(
  '/vendor-data/ingest',
  [
    body('data').isArray().withMessage('Data must be an array'),
    body('metadata').isObject().withMessage('Metadata must be an object'),
    body('metadata.configId').optional().isString(),
    body('metadata.vendorId').optional().isString(),
    body('metadata.dbType').optional().isString()
  ],
  validate,
  async (req, res) => {
    try {
      const { data, metadata } = req.body;

      logger.info('Received vendor data ingestion request', {
        recordCount: data.length,
        metadata
      });

      // ✅ Direct processing without queue
      const result = await processVendorDataDirect(data, metadata);

      if (!result.success) {
        return res.status(500).json(result);
      }

      res.status(200).json({
        success: true,
        message: 'Data processed immediately',
        recordCount: data.length,
        inserted: result.inserted,
        errors: result.errors,
        skipped: result.skipped
      });

    } catch (error) {
      logger.error('Error processing vendor data', { error: error.message });
      res.status(500).json({
        success: false,
        message: 'Failed to process data',
        error: error.message
      });
    }
  }
);

module.exports = router;



/*const express = require('express');
const { body, validationResult } = require('express-validator');
const vendorQueue = require('../../queue/VendorQueue');
const logger = require('../../config/logger');

const router = express.Router();

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn('Validation failed', { errors: errors.array() });
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  next();
};

router.post('/vendor-data/ingest',
  [
    body('data').isArray().withMessage('Data must be an array'),
    body('metadata').isObject().withMessage('Metadata must be an object'),
    body('metadata.configId').optional().isString(),
    body('metadata.vendorId').optional().isString(),
    body('metadata.dbType').optional().isString()
  ],
  validate,
  async (req, res) => {
    try {
      const { data, metadata } = req.body;

      logger.info('Received vendor data ingestion request', {
        recordCount: data.length,
        metadata
      });

      const job = await vendorQueue.addJob(data, metadata);

      res.status(202).json({
        success: true,
        message: 'Data queued for processing',
        jobId: job.id,
        recordCount: data.length
      });

    } catch (error) {
      logger.error('Error queuing vendor data', { error: error.message });
      res.status(500).json({
        success: false,
        message: 'Failed to queue data',
        error: error.message
      });
    }
  }
);

router.get('/vendor-data/job/:jobId', async (req, res) => {
  try {
    const status = await vendorQueue.getJobStatus(req.params.jobId);
    
    if (!status) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    res.json({ success: true, job: status });
  } catch (error) {
    logger.error('Error getting job status', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to get job status',
      error: error.message
    });
  }
});

router.get('/vendor-data/queue/stats', async (req, res) => {
  try {
    const stats = await vendorQueue.getQueueStats();
    res.json({ success: true, stats });
  } catch (error) {
    logger.error('Error getting queue stats', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to get queue stats',
      error: error.message
    });
  }
});

module.exports = router;*/