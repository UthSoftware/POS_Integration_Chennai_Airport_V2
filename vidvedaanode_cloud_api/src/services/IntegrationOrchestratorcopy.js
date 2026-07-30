// const { v4: uuidv4 } = require('uuid');
// const ConfigModel = require('../models/configModel');
// const DataFetcher = require('./DataFetcher');
// const FieldMapper = require('./FieldMapper');
// const dbfieldMApper = require('./DbTransactionMapper');
// const DataInserter = require('./DataInserter');
// const createLogger = require('../config/logger');
// const fs = require('fs').promises;
// const path = require('path');
// const { raw } = require('mysql2');

// class IntegrationOrchestrator {
//   constructor() {
//     this.logger = createLogger('orchestrator');
//   }

//   async executeIngestion() {
//     this.logger.info('Starting data ingestion cycle');

//     try {
//       // Load vendor filter from vendordetails.txt
//       const vendorFilter = await this.loadVendorFilter();

//       const configs = await ConfigModel.getActiveConfigs(vendorFilter);
//       this.logger.info(`Found ${configs.length} active configurations`);

//       for (const config of configs) {
//         await this.processConfig(config);
//       }

//       this.logger.info('Data ingestion cycle completed');
//     } catch (error) {
//       this.logger.error('Ingestion cycle failed', { error: error.message, stack: error.stack });
//     }
//   }

//   async loadVendorFilter() {
//     try {
//       const vendorFilePath = path.join(__dirname, '../../vendordetails.txt');
//       const content = await fs.readFile(vendorFilePath, 'utf-8');

//       const lines = content.split('\n');
//       const vendorLine = lines.find(line => line.startsWith('001|vendor:'));

//       if (vendorLine) {
//         const vendorName = vendorLine.split('vendor:')[1]?.trim();
//         if (vendorName) {
//           this.logger.info('Vendor filter loaded', { vendor: vendorName });
//           return [vendorName];
//         }
//       }

//       this.logger.warn('No vendor filter found in vendordetails.txt');
//       return null;
//     } catch (error) {
//       this.logger.warn('Could not load vendor filter', { error: error.message });
//       return null;
//     }
//   }

//   async processConfig(config) {
//     const batchId = uuidv4();
//     const startTime = new Date();

//     this.logger.info('Processing configuration', {
//       configId: config.cac_config_id,
//       vendor: config.vendor_name,
//       outlet: config.cac_outlet_id,
//       sourceType: config.cac_jsonordb,
//       CUSTOMERID: config.cac_customer_id,
//       URL: config.cac_api_url
//     });

//     const inserter = new DataInserter(config);
//     let client = null;

//     try {
//       // Step 1: Fetch data (with max date logic inside DataFetcher)
//       const fetcher = new DataFetcher(config);
//       const rawData = await fetcher.fetchData();

//       // this.logger.info('RAW API RESPONSE STRUCTURE123', {
//   // type: typeof rawData,
//   // isArray: Array.isArray(rawData),
//   // topKeys: rawData && typeof rawData === 'object'
//     // ? Object.keys(rawData)
//     // : 'NOT_OBJECT'
// // });


//       if (!rawData || (Array.isArray(rawData) && rawData.length === 0)) {
//         this.logger.warn('No data fetched', { configId: config.cac_config_id });
//         return;
//       }

//       this.logger.info('Data fetched successfully', {
//         recordCount: Array.isArray(rawData) ? rawData.length : 1
//       });

//       // Step 2: Get ALL field mappings for this vendor
//       // console.log('Fetching field mappings for vendor ID:', config.cac_customer_id);
//       const allMappings = await ConfigModel.getAllFieldMappings(config.cac_customer_id.trim());

//       // console.log('Total field mappings retrieved:', config.vendor_id);

//       // Step 3: Map data

// let transactions = [];
// // console.log('Source type for mapping:', config.cac_apidbmapping);

//       if (config.cac_apidbmapping?.toLowerCase() === 'db') {

//         // DB Mapping
//       const dbMapper = new dbfieldMApper(config, [
//         ...allMappings.raw_transactions,
//         ...allMappings.raw_transaction_items,
//         ...allMappings.raw_payment
//       ]);
//       // console.log('Using DB field mapper for transactions',rawData);
//       transactions = await dbMapper.mapTransactions(rawData);

//       this.logger.info('DB Data mapped successfully', { 
//         transactionCount: transactions.length 
//       });

         
//     } else {
//       const mapper = new FieldMapper(config, [
//         ...allMappings.raw_transactions,
//         ...allMappings.raw_transaction_items,
//         ...allMappings.raw_payment
//       ]);
//       console.log('Raw data to be mapped:', JSON.stringify(rawData, null, 2));
//       transactions = await mapper.mapTransactions(rawData);

//       this.logger.info('Data mapped successfully', {
//         transactionCount: transactions.length
//       });
//     }

//       // Step 4: Insert data in transaction with duplicate checking
//       client = await inserter.pool.connect();

//       let totalRecords = 0;
//       let totalErrors = 0;
//       let totalSkipped = 0;

//       await client.query('BEGIN');
// //  console.log('Checking transaction exists', 1);
//       try {
//         for (const transaction of transactions) {
//           try {
//           //  console.log('Checking transaction exists', transaction.invoice_no);
//             // 🔹 Check if transaction already exists
//             const exists = await inserter.checkTransactionExists(client, transaction);

//             if (exists) {
//               totalSkipped++;
//               // this.logger.info('Transaction already exists, skipping', {
//                 // transaction_id: transaction.transaction_id,
//                 // invoice_no: transaction.invoice_no
//               // });
//               continue;
//             }
// // console.log('Inserted transaction', {payments: transaction.payments.length});
// if (transaction.transaction_type === 'RETURN') {
//               // =====================================================
//               // RETURN: insert new row with only salesret_amt filled
//               // No items. No payments.
//               // =====================================================
//               await inserter.insertReturnTransaction(client, transaction);

//               this.logger.info('RETURN row inserted', {
//                 invoice_no: transaction.invoice_no,
//                 salesret_amt: Math.abs(parseFloat(transaction.salesret_amt) || 0)
//               });

//             } else {
//             // Insert transaction
//             await inserter.insertTransaction(client, transaction);

//             // Insert items if available
//             if (transaction.items && transaction.items.length > 0) {
//               await inserter.insertTransactionItems(client, transaction.items, transaction);
//             }
            
//             // Insert payments if available
//             if (transaction.payments && transaction.payments.length > 0) {
//               await inserter.insertPayments(client, transaction.payments, transaction);
//             }

//             totalRecords++;
//             }
//           } catch (error) {
//             totalErrors++;
//             this.logger.error('Transaction insert failed', {
//               transactionId: transaction.transaction_id,
//               error: error.message,
//               stack: error.stack
//             });

//             // Log exception
//             await inserter.logException(client, {
//               transaction_id: transaction.transaction_id,
//               brand_id: transaction.brand_id,
//               brand_name: transaction.brand_name,
//               outlet_id: transaction.outlet_id,
//               outlet_name: transaction.outlet_name,
//               event_type: 'INSERT_ERROR',
//               terminal: transaction.terminal,
//               gate: transaction.gate,
//               user: 'system',
//               reason: error.message,
//               details: { transaction, error: error.stack }
//             });
//           }
//         }

//         await client.query('COMMIT');

//         // Step 5: Log successful ingestion
//         await inserter.logIngestion({
//           agent_id: config.cac_config_id,
//           batch_id: batchId,
//           source_system: config.cac_pos_vendor,
//           outlet_id: config.com_outlet_id,
//           outlet_name: config.cac_outlet_id,
//           brand_id: config.com_brand_id,
//           brand_name: config.brand_name,
//           terminal: config.com_terminal,
//           gate: config.com_gate,
//           records_count: totalRecords,
//           errors_count: totalErrors,
//           first_received_at: startTime,
//           last_received_at: new Date(),
//           status: 'SUCCESS',
//           meta: {
//             batchId,
//             configId: config.cac_config_id,
//             skippedCount: totalSkipped
//           }
//         });

//         this.logger.info('Configuration processed successfully', {
//           configId: config.cac_config_id,
//           records: totalRecords,
//           errors: totalErrors,
//           skipped: totalSkipped
//         });

//       } catch (error) {
//         await client.query('ROLLBACK');
//         throw error;
//       }

//     } catch (error) {
//       this.logger.error('Configuration processing failed', {
//         configId: config.cac_config_id,
//         error: error.message,
//         stack: error.stack
//       });

//       // Log failure
//       await inserter.logIngestion({
//         agent_id: config.cac_config_id,
//         batch_id: batchId,
//         source_system: config.cac_pos_vendor,
//         outlet_id: config.com_outlet_id,
//         outlet_name: config.cac_outlet_id,
//         brand_id: config.com_brand_id,
//         brand_name: config.brand_name,
//         terminal: config.com_terminal,
//         gate: config.com_gate,
//         records_count: 0,
//         errors_count: 1,
//         first_received_at: startTime,
//         last_received_at: new Date(),
//         status: 'FAILED',
//         meta: { error: error.message, stack: error.stack }
//       });
//     } finally {
//       if (client) {
//         client.release();
//       }
//     }
//   }
// }

// module.exports = IntegrationOrchestrator;







const { v4: uuidv4 } = require('uuid');
const ConfigModel = require('../models/configModel');
const DataFetcher = require('./DataFetcher');
const FieldMapper = require('./FieldMapper');
const dbfieldMApper = require('./DbTransactionMapper');
const DataInserter = require('./DataInserter');
const createLogger = require('../config/logger');
const fs = require('fs').promises;
const path = require('path');
const { raw } = require('mysql2');

// ============================================================
// BACKFILL IMPORT — only new line added at the top
// ============================================================
const { BACKFILL_MODE, BACKFILL_START_DATE, BACKFILL_END_DATE } = require('./backfillConfig');

class IntegrationOrchestrator {
  constructor() {
    this.logger = createLogger('orchestrator');
  }

  // ============================================================
  // BACKFILL LOCK — static flag shared across all cron invocations.
  // When backfill is running, any cron trigger that calls
  // executeIngestion() will see isBackfillRunning === true and
  // return immediately without doing any work.
  // ============================================================
  static isBackfillRunning = false;

  // ============================================================
  // BACKFILL HELPERS
  // ============================================================

  /**
   * Generates an array of Date objects, one per calendar day,
   * from startDateStr (YYYY-MM-DD) up to and including endDate.
   */
  _generateBackfillDates(startDateStr, endDate) {
    const dates = [];
    // Parse start — treat as local midnight to avoid timezone drift
    const [sy, sm, sd] = startDateStr.split('-').map(Number);
    const cursor = new Date(sy, sm - 1, sd); // local midnight

    const end = new Date(
      endDate.getFullYear(),
      endDate.getMonth(),
      endDate.getDate()
    ); // local midnight of end day

    while (cursor <= end) {
      dates.push(new Date(cursor));  // snapshot
      cursor.setDate(cursor.getDate() + 1);
    }
    return dates;
  }

  // ============================================================
  // executeIngestion — BACKFILL CHANGE:
  //   • When BACKFILL_MODE is false → runs exactly as before (zero change).
  //   • When BACKFILL_MODE is true  → acquires the static lock, loops
  //     through every date from BACKFILL_START_DATE to today (or
  //     BACKFILL_END_DATE), calls processConfig for each config on each
  //     date sequentially, then releases the lock.
  //   The existing normal-mode code block is UNTOUCHED.
  // ============================================================
  async executeIngestion() {

    // ── BACKFILL GUARD: if a backfill run is already in progress,
    //    silently skip this cron tick entirely.
    if (IntegrationOrchestrator.isBackfillRunning) {
      this.logger.info('Backfill in progress — skipping this cron tick');
      return;
    }

    // ── NORMAL MODE: exactly the original code, not touched at all ──
    if (!BACKFILL_MODE) {
      this.logger.info('Starting data ingestion cycle');

      try {
        // Load vendor filter from vendordetails.txt
        const vendorFilter = await this.loadVendorFilter();

        const configs = await ConfigModel.getActiveConfigs(vendorFilter);
        this.logger.info(`Found ${configs.length} active configurations`);

        for (const config of configs) {
          await this.processConfig(config);
        }

        this.logger.info('Data ingestion cycle completed');
      } catch (error) {
        this.logger.error('Ingestion cycle failed', { error: error.message, stack: error.stack });
      }

      return; // ← normal mode done, exit
    }

    // ── BACKFILL MODE ────────────────────────────────────────────────
    IntegrationOrchestrator.isBackfillRunning = true;
    this.logger.info('=== BACKFILL MODE STARTED ===', {
      startDate: BACKFILL_START_DATE,
      endDate: BACKFILL_END_DATE || 'today'
    });

    try {
      // Load vendor filter (same as normal mode)
      const vendorFilter = await this.loadVendorFilter();
      const configs = await ConfigModel.getActiveConfigs(vendorFilter);
      this.logger.info(`Backfill: found ${configs.length} active configurations`);

      // Determine the end date
      const endDate = BACKFILL_END_DATE
        ? (() => {
            const [ey, em, ed] = BACKFILL_END_DATE.split('-').map(Number);
            return new Date(ey, em - 1, ed);
          })()
        : new Date(); // today

      // Build the list of dates to process
      const dates = this._generateBackfillDates(BACKFILL_START_DATE, endDate);
      this.logger.info(`Backfill: will process ${dates.length} date(s)`);

      // ── Outer loop: one date at a time ──────────────────────────
      for (const date of dates) {
        const dateStr = date.toISOString().slice(0, 10);
        this.logger.info(`Backfill: processing date ${dateStr}`);

        // ── Inner loop: all configs for this date ────────────────
        for (const config of configs) {
          // overrideMaxDate = FROM_DATE for this day
          // overrideToDate  = TO_DATE  for this day (same day → single-day fetch)
          await this.processConfig(config, date, date);
        }

        this.logger.info(`Backfill: completed date ${dateStr}`);
      }

      this.logger.info('=== BACKFILL MODE COMPLETED ===');

    } catch (error) {
      this.logger.error('Backfill cycle failed', { error: error.message, stack: error.stack });
    } finally {
      // Always release the lock so future cron ticks resume normally
      IntegrationOrchestrator.isBackfillRunning = false;
    }
  }

  async loadVendorFilter() {
    try {
      const vendorFilePath = path.join(__dirname, '../../vendordetails.txt');
      const content = await fs.readFile(vendorFilePath, 'utf-8');

      const lines = content.split('\n');
      const vendorLine = lines.find(line => line.startsWith('001|vendor:'));

      if (vendorLine) {
        const vendorName = vendorLine.split('vendor:')[1]?.trim();
        if (vendorName) {
          this.logger.info('Vendor filter loaded', { vendor: vendorName });
          return [vendorName];
        }
      }

      this.logger.warn('No vendor filter found in vendordetails.txt');
      return null;
    } catch (error) {
      this.logger.warn('Could not load vendor filter', { error: error.message });
      return null;
    }
  }

  // ============================================================
  // processConfig — BACKFILL CHANGE (only the signature + one call):
  //   Added two optional parameters:
  //     overrideMaxDate — passed straight through to fetcher.fetchData()
  //     overrideToDate  — passed straight through to fetcher.fetchData()
  //
  //   When both are null (normal cron mode) the behaviour is
  //   100% identical to the original. All other logic is untouched.
  // ============================================================
  async processConfig(config, overrideMaxDate = null, overrideToDate = null) {
    const batchId = uuidv4();
    const startTime = new Date();

    this.logger.info('Processing configuration', {
      configId: config.cac_config_id,
      vendor: config.vendor_name,
      outlet: config.cac_outlet_id,
      sourceType: config.cac_jsonordb,
      CUSTOMERID: config.cac_customer_id,
      URL: config.cac_api_url,
      // Log the backfill date when applicable
      ...(overrideMaxDate ? { backfillDate: overrideMaxDate.toISOString().slice(0, 10) } : {})
    });

    const inserter = new DataInserter(config);
    let client = null;

    try {
      // Step 1: Fetch data (with max date logic inside DataFetcher)
      const fetcher = new DataFetcher(config);
      // ── ONLY CHANGE: pass the two optional override dates ──────────
      const rawData = await fetcher.fetchData(overrideMaxDate, overrideToDate);
      // ──────────────────────────────────────────────────────────────

      if (!rawData || (Array.isArray(rawData) && rawData.length === 0)) {
        this.logger.warn('No data fetched', { configId: config.cac_config_id });
        return;
      }

      this.logger.info('Data fetched successfully', {
        recordCount: Array.isArray(rawData) ? rawData.length : 1
      });

      // Step 2: Get ALL field mappings for this vendor
      const allMappings = await ConfigModel.getAllFieldMappings(config.cac_customer_id.trim());

      // Step 3: Map data
      let transactions = [];

      if (config.cac_apidbmapping?.toLowerCase() === 'db') {

        // DB Mapping
      const dbMapper = new dbfieldMApper(config, [
        ...allMappings.raw_transactions,
        ...allMappings.raw_transaction_items,
        ...allMappings.raw_payment
      ]);
       transactions = await dbMapper.mapTransactions(rawData);

      this.logger.info('DB Data mapped successfully', { 
        transactionCount: transactions.length 
      });

         
    } else {
       const mapper = new FieldMapper(config, [
        ...allMappings.raw_transactions,
        ...allMappings.raw_transaction_items,
        ...allMappings.raw_payment
      ]);
      console.log('Raw data to be mapped:', JSON.stringify(rawData, null, 2));
       transactions = await mapper.mapTransactions(rawData);

      this.logger.info('Data mapped successfully', {
        transactionCount: transactions.length
      });
    }

      // Step 4: Insert data in transaction with duplicate checking
      client = await inserter.pool.connect();

      let totalRecords = 0;
      let totalErrors = 0;
      let totalSkipped = 0;

      await client.query('BEGIN');

      try {
        for (const transaction of transactions) {
          try {
            // 🔹 Check if transaction already exists
            const exists = await inserter.checkTransactionExists(client, transaction);

            if (exists) {
              totalSkipped++;
              continue;
            }

if (transaction.transaction_type === 'RETURN') {
              // =====================================================
              // RETURN: insert new row with only salesret_amt filled
              // No items. No payments.
              // =====================================================
              await inserter.insertReturnTransaction(client, transaction);

              this.logger.info('RETURN row inserted', {
                invoice_no: transaction.invoice_no,
                salesret_amt: Math.abs(parseFloat(transaction.salesret_amt) || 0)
              });

            } else {
            // Insert transaction
            await inserter.insertTransaction(client, transaction);

            // Insert items if available
            if (transaction.items && transaction.items.length > 0) {
              await inserter.insertTransactionItems(client, transaction.items, transaction);
            }
            
            // Insert payments if available
            if (transaction.payments && transaction.payments.length > 0) {
              await inserter.insertPayments(client, transaction.payments, transaction);
            }

            totalRecords++;
            }
          } catch (error) {
            totalErrors++;
            this.logger.error('Transaction insert failed', {
              transactionId: transaction.transaction_id,
              error: error.message,
              stack: error.stack
            });

            // Log exception
            await inserter.logException(client, {
              transaction_id: transaction.transaction_id,
              brand_id: transaction.brand_id,
              brand_name: transaction.brand_name,
              outlet_id: transaction.outlet_id,
              outlet_name: transaction.outlet_name,
              event_type: 'INSERT_ERROR',
              terminal: transaction.terminal,
              gate: transaction.gate,
              user: 'system',
              reason: error.message,
              details: { transaction, error: error.stack }
            });
          }
        }

        await client.query('COMMIT');

        // Step 5: Log successful ingestion
        await inserter.logIngestion({
          agent_id: config.cac_config_id,
          batch_id: batchId,
          source_system: config.cac_pos_vendor,
          outlet_id: config.com_outlet_id,
          outlet_name: config.cac_outlet_id,
          brand_id: config.com_brand_id,
          brand_name: config.brand_name,
          terminal: config.com_terminal,
          gate: config.com_gate,
          records_count: totalRecords,
          errors_count: totalErrors,
          first_received_at: startTime,
          last_received_at: new Date(),
          status: 'SUCCESS',
          meta: {
            batchId,
            configId: config.cac_config_id,
            skippedCount: totalSkipped,
            // Include backfill date in meta when applicable
            ...(overrideMaxDate ? { backfillDate: overrideMaxDate.toISOString().slice(0, 10) } : {})
          }
        });

        this.logger.info('Configuration processed successfully', {
          configId: config.cac_config_id,
          records: totalRecords,
          errors: totalErrors,
          skipped: totalSkipped
        });

      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }

    } catch (error) {
      this.logger.error('Configuration processing failed', {
        configId: config.cac_config_id,
        error: error.message,
        stack: error.stack
      });

      // Log failure
      await inserter.logIngestion({
        agent_id: config.cac_config_id,
        batch_id: batchId,
        source_system: config.cac_pos_vendor,
        outlet_id: config.com_outlet_id,
        outlet_name: config.cac_outlet_id,
        brand_id: config.com_brand_id,
        brand_name: config.brand_name,
        terminal: config.com_terminal,
        gate: config.com_gate,
        records_count: 0,
        errors_count: 1,
        first_received_at: startTime,
        last_received_at: new Date(),
        status: 'FAILED',
        meta: { error: error.message, stack: error.stack }
      });
    } finally {
      if (client) {
        client.release();
      }
    }
  }
}

module.exports = IntegrationOrchestrator;