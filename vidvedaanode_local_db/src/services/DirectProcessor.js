const DbTransactionMapper = require('./DbTransactionMapper');
const DataInserter = require('./DataInserter');
const ConfigModel = require('../models/configModel');
const createLogger = require('../config/logger');

const logger = createLogger('direct-processor');

/**
 * Process vendor data immediately (queue-free)
 * @param {Array} data - vendor transactions
 * @param {Object} metadata - { configId, vendorId, etc }
 */
/*async function processVendorDataDirect(data, metadata) {
    
    let client = null;
  try {
    logger.info('Starting direct processing', {
      recordCount: Array.isArray(data) ? data.length : 1,
      metadata
    });

    // Load config by ID
    const config = await ConfigModel.getConfigById(metadata.vendorid);
    if (!config) throw new Error(`Configuration not found: ${metadata.vendorid}`);

    console.log('Loaded config for direct processing:', config.cac_customer_id);
    // Load all field mappings for this config/vendor
    const fieldMappings = await ConfigModel.getAllFieldMappings(config.cac_customer_id);

    // Map transactions
    const mapper = new DbTransactionMapper(config, [
      ...fieldMappings.raw_transactions,
      ...fieldMappings.raw_transaction_items,
      ...fieldMappings.raw_payment
    ]);
// console.log('Field mappings loaded for direct processing:', data);
    const transactions = mapper.mapTransactions(data);

    logger.info('Transactions mapped successfully', { transactionCount: transactions.length });

    // Insert transactions into DB
    // const inserter = new DataInserter(config);
    // const result = await inserter.insertTransactions(transactions);

    // logger.info('Transactions inserted successfully', {
      // inserted: result.successCount,
      // errors: result.errorCount,
      // skipped: result.skippedCount
    // });

    // return {
      // success: true,
      // recordsProcessed: transactions.length,
      // inserted: result.successCount,
      // errors: result.errorCount,
      // skipped: result.skippedCount
    // };
  // } catch (error) {
    // logger.error('Direct processing failed', { error: error.message, stack: error.stack });
    // return {
      // success: false,
      // error: error.message
    // };
  // }
 
const inserter = new DataInserter(config);
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
              this.logger.info('Transaction already exists, skipping', {
                transaction_id: transaction.transaction_id,
                invoice_no: transaction.invoice_no
              });
              continue;
            }

            // Insert transaction
            await inserter.insertTransaction(client, transaction);

            // Insert items if available
            if (transaction.items && transaction.items.length > 0) {
              await inserter.insertTransactionItems(client, transaction.items, transaction);
            }
            // console.log('Inserted transaction', {payments: transaction.payments.length});
            // Insert payments if available
            if (transaction.payments && transaction.payments.length > 0) {
              await inserter.insertPayments(client, transaction.payments, transaction);
            }

            totalRecords++;
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
            skippedCount: totalSkipped
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
  

  
}*/

async function processVendorDataDirect(data, metadata) {
  let client;
  let config;

  const batchId = `direct-${Date.now()}`;
  const startTime = new Date();

  try {
    logger.info('Starting direct processing', {
      recordCount: Array.isArray(data) ? data.length : 1,
      metadata
    });

    // ✅ FIX: correct key
    config = await ConfigModel.getConfigById(metadata.vendorid);
    if (!config) {
      throw new Error(`Configuration not found: ${metadata.vendorid}`);
    }

    const fieldMappings = await ConfigModel.getAllFieldMappings(
      config.cac_customer_id
    );

    const mapper = new DbTransactionMapper(config, [
      ...fieldMappings.raw_transactions,
      ...fieldMappings.raw_transaction_items,
      ...fieldMappings.raw_payment
    ]);

    const transactions = mapper.mapTransactions(data);

    const inserter = new DataInserter(config);
    client = await inserter.pool.connect();

    let totalRecords = 0;
    let totalErrors = 0;
    let totalSkipped = 0;

    await client.query('BEGIN');

    for (const transaction of transactions) {
      try {
        const exists = await inserter.checkTransactionExists(client, transaction);
        if (exists) {
          totalSkipped++;
          continue;
        }

        await inserter.insertTransaction(client, transaction);

        if (transaction.items?.length) {
          await inserter.insertTransactionItems(client, transaction.items, transaction);
        }

        if (transaction.payments?.length) {
          await inserter.insertPayments(client, transaction.payments, transaction);
        }

        totalRecords++;
      } catch (err) {
        totalErrors++;
        logger.error('Transaction insert failed', {
          transactionId: transaction.transaction_id,
          error: err.message
        });

        await inserter.logException(client, {
          transaction_id: transaction.transaction_id,
          reason: err.message,
          details: err.stack
        });
      }
    }

    await client.query('COMMIT');

    await inserter.logIngestion({
      agent_id: config.cac_config_id,
      batch_id: batchId,
      records_count: totalRecords,
      errors_count: totalErrors,
      first_received_at: startTime,
      last_received_at: new Date(),
      status: 'SUCCESS',
      meta: { skipped: totalSkipped }
    });

    return {
      success: true,
      inserted: totalRecords,
      errors: totalErrors,
      skipped: totalSkipped
    };

  } catch (error) {
    if (client) await client.query('ROLLBACK');

    logger.error('Direct processing failed', {
      error: error.message,
      stack: error.stack
    });

    return {
      success: false,
      error: error.message,
      inserted: 0,
      skipped: 0,
      errors: [error.message]
    };

  } finally {
    if (client) client.release();
  }
}

module.exports = { processVendorDataDirect };
