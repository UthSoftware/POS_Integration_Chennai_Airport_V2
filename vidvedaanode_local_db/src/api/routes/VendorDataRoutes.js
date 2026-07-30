// const express = require('express');
// const { body, validationResult } = require('express-validator');
// const { processVendorDataDirect } = require('../../services/DirectProcessor'); // your new direct processor
// const createLogger = require('../../config/logger');
// const logger = createLogger('vendor-api');

// const router = express.Router();

// // Validation middleware
// const validate = (req, res, next) => {
//   const errors = validationResult(req);
//   if (!errors.isEmpty()) {
//     logger.warn('Validation failed', { errors: errors.array() });
//     return res.status(400).json({ success: false, errors: errors.array() });
//   }
//   next();
// };

// // ================= POST /vendor-data/ingest =================
// router.post(
//   '/vendor-data/ingest',
//   [
//     body('data').isArray().withMessage('Data must be an array'),
//     body('metadata').isObject().withMessage('Metadata must be an object'),
//     body('metadata.configId').optional().isString(),
//     body('metadata.vendorId').optional().isString(),
//     body('metadata.dbType').optional().isString()
//   ],
//   validate,
//   async (req, res) => {
//     try {
//       const { data, metadata } = req.body;

//       logger.info('Received vendor data ingestion request', {
//         recordCount: data.length,
//         metadata
//       });

//       // ✅ Direct processing without queue
//       const result = await processVendorDataDirect(data, metadata);

//       if (!result.success) {
//         return res.status(500).json(result);
//       }

//       res.status(200).json({
//         success: true,
//         message: 'Data processed immediately',
//         recordCount: data.length,
//         inserted: result.inserted,
//         errors: result.errors,
//         skipped: result.skipped
//       });

//     } catch (error) {
//       logger.error('Error processing vendor data', { error: error.message });
//       res.status(500).json({
//         success: false,
//         message: 'Failed to process data',
//         error: error.message
//       });
//     }
//   }
// );

// module.exports = router;



// /*const express = require('express');
// const { body, validationResult } = require('express-validator');
// const vendorQueue = require('../../queue/VendorQueue');
// const logger = require('../../config/logger');

// const router = express.Router();

// const validate = (req, res, next) => {
//   const errors = validationResult(req);
//   if (!errors.isEmpty()) {
//     logger.warn('Validation failed', { errors: errors.array() });
//     return res.status(400).json({ success: false, errors: errors.array() });
//   }
//   next();
// };

// router.post('/vendor-data/ingest',
//   [
//     body('data').isArray().withMessage('Data must be an array'),
//     body('metadata').isObject().withMessage('Metadata must be an object'),
//     body('metadata.configId').optional().isString(),
//     body('metadata.vendorId').optional().isString(),
//     body('metadata.dbType').optional().isString()
//   ],
//   validate,
//   async (req, res) => {
//     try {
//       const { data, metadata } = req.body;

//       logger.info('Received vendor data ingestion request', {
//         recordCount: data.length,
//         metadata
//       });

//       const job = await vendorQueue.addJob(data, metadata);

//       res.status(202).json({
//         success: true,
//         message: 'Data queued for processing',
//         jobId: job.id,
//         recordCount: data.length
//       });

//     } catch (error) {
//       logger.error('Error queuing vendor data', { error: error.message });
//       res.status(500).json({
//         success: false,
//         message: 'Failed to queue data',
//         error: error.message
//       });
//     }
//   }
// );

// router.get('/vendor-data/job/:jobId', async (req, res) => {
//   try {
//     const status = await vendorQueue.getJobStatus(req.params.jobId);
    
//     if (!status) {
//       return res.status(404).json({
//         success: false,
//         message: 'Job not found'
//       });
//     }

//     res.json({ success: true, job: status });
//   } catch (error) {
//     logger.error('Error getting job status', { error: error.message });
//     res.status(500).json({
//       success: false,
//       message: 'Failed to get job status',
//       error: error.message
//     });
//   }
// });

// router.get('/vendor-data/queue/stats', async (req, res) => {
//   try {
//     const stats = await vendorQueue.getQueueStats();
//     res.json({ success: true, stats });
//   } catch (error) {
//     logger.error('Error getting queue stats', { error: error.message });
//     res.status(500).json({
//       success: false,
//       message: 'Failed to get queue stats',
//       error: error.message
//     });
//   }
// });

// module.exports = router;*/









const express = require('express');
const { body, validationResult } = require('express-validator');
const { processVendorDataDirect } = require('../../services/DirectProcessor'); // your new direct processor
const createLogger = require('../../config/logger');
const transactionCountService = require('../../services/TransactionCountService'); // reconciliation
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

// ================= GET /vendor-data/transaction-count =================
// Used by client reconciliation service to compare server-side count vs client count
// Query params: vendorid (required), date (required, YYYY-MM-DD)
router.get('/vendor-data/transaction-count', async (req, res) => {
  try {
    const { vendorid, date } = req.query;

    if (!vendorid || !date) {
      return res.status(400).json({
        success: false,
        message: 'vendorid and date query parameters are required'
      });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        success: false,
        message: 'date must be in YYYY-MM-DD format'
      });
    }

    logger.info('Reconciliation count request', { vendorid, date });

    const result = await transactionCountService.getCountForDate(vendorid, date);

    res.status(200).json({
      success     : true,
      vendorid,
      date,
      brand_id    : result.brand_id,
      brand_name  : result.brand_name,
      terminal    : result.terminal,
      count       : result.count
    });

  } catch (error) {
    logger.error('Error fetching transaction count', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transaction count',
      error  : error.message
    });
  }
});

// ================= GET /vendor-data/field-mapping =================
// Returns vendor column names for invoice_no and date
// Client uses these to build its count query against vendor DB
// Query params: vendorid (required)
router.get('/vendor-data/field-mapping', async (req, res) => {
  try {
    const { vendorid } = req.query;

    if (!vendorid) {
      return res.status(400).json({
        success: false,
        message: 'vendorid query parameter is required'
      });
    }

    logger.info('Field mapping request for reconciliation', { vendorid });

    const result = await transactionCountService.getFieldInfo(vendorid);

    res.status(200).json({
      success     : true,
      vendorid,
      invoice_col : result.invoice_col,
      date_col    : result.date_col,
      source_type : result.source_type,
      brand_id    : result.brand_id,
      brand_name  : result.brand_name,
      terminal    : result.terminal
    });

  } catch (error) {
    logger.error('Error fetching field mapping', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to fetch field mapping',
      error  : error.message
    });
  }
});

// ================= POST /vendor-data/reconcile =================
// Manual reconciliation trigger — call from Postman / curl to force a
// reconciliation check for a specific vendor + date without touching the client machine.
//
// This endpoint ONLY performs the server-side count check and returns the result.
// The actual repush (fetching from the vendor DB and re-posting) must happen on the
// CLIENT side because only the client machine has access to the vendor's local DB.
//
// To trigger a full repush remotely, use the CLI on the client machine:
//   node index.js --reconcile --date YYYY-MM-DD [--force]
//
// Body: { "vendorid": "VVC00103", "date": "2026-04-03" }
router.post('/vendor-data/reconcile', async (req, res) => {
  try {
    const { vendorid, date } = req.body;

    if (!vendorid || !date) {
      return res.status(400).json({
        success: false,
        message: 'vendorid and date are required in request body'
      });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        success: false,
        message: 'date must be in YYYY-MM-DD format'
      });
    }

    logger.info('Manual reconciliation check requested', { vendorid, date });

    // Get server-side count for this vendor + date
    const countResult = await transactionCountService.getCountForDate(vendorid, date);

    // Get the vendor's field info so the caller can see the column mapping
    const fieldInfo = await transactionCountService.getFieldInfo(vendorid);

    logger.info('Manual reconciliation check complete', {
      vendorid, date,
      server_count: countResult.count
    });

    res.status(200).json({
      success       : true,
      message       : 'Server-side count check complete. To trigger a full repush, run: node index.js --reconcile --date ' + date + ' --force  on the client machine.',
      vendorid,
      date,
      brand_id      : countResult.brand_id,
      brand_name    : countResult.brand_name,
      terminal      : countResult.terminal,
      server_count  : countResult.count,
      field_mapping : {
        invoice_col : fieldInfo.invoice_col,
        date_col    : fieldInfo.date_col,
        source_type : fieldInfo.source_type
      }
    });

  } catch (error) {
    logger.error('Error during manual reconciliation check', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Manual reconciliation check failed',
      error  : error.message
    });
  }
});

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