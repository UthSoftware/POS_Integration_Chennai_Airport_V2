const fs = require('fs').promises;
const path = require('path');
const soapService = require('./soapService');
const cloudPoster = require('./cloudPoster');
const { sanitizeReceipts } = require('../utils/dataSanitizer');
const logger = require('../config/logger');

class DataFetcher {
  getTodayDateRange() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');

    const year = now.getFullYear();
    const month = pad(now.getMonth() + 1);
    const day = pad(now.getDate());

    const fromDate = `${year}-${month}-${day}T00:00:00`;
    const toDate = `${year}-${month}-${day}T23:59:59`;

    return { fromDate, toDate };
  }

  async loadMockData(customPath) {
    const mockPath = customPath || process.env.MOCK_DATA_FILE || './data/sample_soap_response.json';
    const resolvedPath = path.resolve(__dirname, '../../', mockPath);

    logger.info(`Loading mock data from ${resolvedPath}`);
    const rawContent = await fs.readFile(resolvedPath, 'utf8');
    const parsed = JSON.parse(rawContent);
    return parsed;
  }

  async fetchAndPost(options = {}) {
    try {
      const mode = options.mode || process.env.DATA_SOURCE_MODE || 'mock';
      const today = this.getTodayDateRange();
      const fromDate = options.fromDate || process.env.FROM_DATE || today.fromDate;
      const toDate = options.toDate || process.env.TO_DATE || today.toDate;

      logger.info('=== Starting Data Fetch Cycle ===', {
        mode,
        fromDate,
        toDate
      });

      let rawGroupedData = [];
      let actualModeUsed = mode;

      if (mode === 'mock') {
        rawGroupedData = await this.loadMockData(options.mockFile);
      } else if (mode === 'live') {
        rawGroupedData = await soapService.fetchAndGroupAllSegments(fromDate, toDate);
      } else if (mode === 'auto') {
        try {
          logger.info('Auto mode: Attempting live SOAP call first...');
          rawGroupedData = await soapService.fetchAndGroupAllSegments(fromDate, toDate);
          actualModeUsed = 'live';
        } catch (soapError) {
          logger.warn(`Auto mode: Live SOAP call failed (${soapError.message}). Falling back to mock data.`);
          rawGroupedData = await this.loadMockData(options.mockFile);
          actualModeUsed = 'mock-fallback';
        }
      } else {
        throw new Error(`Invalid DATA_SOURCE_MODE: ${mode}. Must be 'mock', 'live', or 'auto'.`);
      }

      // Sanitize fields and remove XML diffgram noise ($ attributes)
      const cleanReceipts = sanitizeReceipts(rawGroupedData);

      if (!cleanReceipts || cleanReceipts.length === 0) {
        logger.warn('No receipts found to process.');
        return { success: true, recordCount: 0 };
      }

      // Console summary for operator
      console.log('\n' + '='.repeat(80));
      console.log(`📦 PROCESSED RECEIPTS SUMMARY [${cleanReceipts.length} Total Receipts] (Mode: ${actualModeUsed})`);
      console.log('='.repeat(80));
      const sample = cleanReceipts.slice(0, 3);
      sample.forEach((r, idx) => {
        console.log(`🧾 Receipt #${idx + 1}: ${r.receipt_no}`);
        console.log(`   Time: ${r.transaction.TIMESTAMP} | Net Amt: ₹${r.transaction.NET_AMT} | Items: ${r.items.length} | Payments: ${r.payments.length}`);
      });
      if (cleanReceipts.length > 3) {
        console.log(`... and ${cleanReceipts.length - 3} more receipts.`);
      }
      console.log('='.repeat(80) + '\n');

      const metadata = {
        connectionType: 'soap',
        sourceMode: actualModeUsed,
        fromDate,
        toDate,
        totalReceipts: cleanReceipts.length
      };

      // Send to Cloud API
      const postResult = await cloudPoster.postData(cleanReceipts, metadata);

      logger.info('=== Data Fetch and Post Cycle Completed Successfully ===', {
        recordCount: cleanReceipts.length,
        postStatus: postResult.status
      });

      return {
        success: true,
        recordCount: cleanReceipts.length,
        postResult
      };
    } catch (error) {
      logger.error('Data Fetch & Post Cycle Failed', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }
}

module.exports = new DataFetcher();
