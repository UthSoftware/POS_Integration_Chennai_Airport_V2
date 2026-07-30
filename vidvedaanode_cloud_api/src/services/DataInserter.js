const pool = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const createLogger = require('../config/logger');

class DataInserter {
  constructor(config) {
    this.config = config;
    this.pool = pool;
    this.logger = createLogger(config.vendor_name || 'inserter');
  }

  async insertTransactions(transactions) {
    const client = await pool.connect();
    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;

    try {
      await client.query('BEGIN');

      for (const transaction of transactions) {
        try {
          await client.query('SAVEPOINT tx_savepoint');

          // =====================================================
          // Check duplicate using (invoice_no + brand_id + transaction_type)
          // This matches the DB constraint:
          //   UNIQUE (invoice_no, brand_id, transaction_type)
          //
          // So:
          //   invoice OR26-1  SALE   → not found → INSERT ✅
          //   invoice OR26-1  RETURN → not found → INSERT ✅ (different type)
          //   invoice OR26-1  SALE   → found → SKIP ✅ (next run)
          //   invoice OR26-1  RETURN → found → SKIP ✅ (next run)
          // =====================================================
          const exists = await this.checkTransactionExists(client, transaction);

          if (exists) {
            skippedCount++;
            this.logger.info('Transaction already exists, skipping', {
              invoice_no: transaction.invoice_no,
              transaction_type: transaction.transaction_type
            });
            await client.query('RELEASE SAVEPOINT tx_savepoint');
            continue;
          }

          if (transaction.transaction_type === 'RETURN') {
            // =====================================================
            // RETURN row: insert with ONLY salesret_amt filled.
            // All other amount fields are NULL.
            // No items. No payments.
            // =====================================================
            await this.insertReturnTransaction(client, transaction);
            this.logger.info('RETURN row inserted', {
              invoice_no: transaction.invoice_no,
              salesret_amt: Math.abs(parseFloat(transaction.salesret_amt) || 0)
            });

          } else {
            // =====================================================
            // SALE row: normal full insert with items and payments
            // =====================================================
            await this.insertTransaction(client, transaction);
            this.logger.info('Transaction inserted', {
              invoice_no: transaction.invoice_no,
              transaction_type: transaction.transaction_type,
              net_amount: transaction.net_amount
            });
          }

          successCount++;
          await client.query('RELEASE SAVEPOINT tx_savepoint');

        } catch (error) {
          // Roll back only this one transaction — batch continues
          await client.query('ROLLBACK TO SAVEPOINT tx_savepoint');

          errorCount++;
          this.logger.error('Transaction processing failed', {
            error: error.message,
            invoice_no: transaction.invoice_no,
            transaction_type: transaction.transaction_type
          });

          try {
            await this.logException(client, {
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
          } catch (logErr) {
            this.logger.error('Failed to log exception', { error: logErr.message });
          }
        }
      }

      await client.query('COMMIT');
      this.logger.info('Batch completed', {
        inserted: successCount,
        skipped: skippedCount,
        errors: errorCount
      });

      return { successCount, errorCount, skippedCount };

    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error('Batch insert failed', { error: error.message });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Check if a transaction already exists.
   * Uses (invoice_no + brand_id + transaction_type) to match DB constraint:
   *   UNIQUE (invoice_no, brand_id, transaction_type)
   *
   * This allows same invoice to have both SALE and RETURN rows.
   */
//   async checkTransactionExists(client, transaction) {
//     const query = `
//       SELECT 1 FROM raw_transactions
//       WHERE invoice_no      = $1
//         AND brand_id        = $2
//         AND transaction_type = $3
//       LIMIT 1
//     `;

//     const result = await client.query(query, [
//       transaction.invoice_no,
//       transaction.brand_id,
//       transaction.transaction_type
//     ]);

//     return result.rows.length > 0;
//   }
 async checkTransactionExists(client, transaction) {
    const query = `
      SELECT 1 FROM raw_transactions
      WHERE invoice_no = $1
      and brand_id  =$2
      and transaction_time =$3
      and transaction_type =$4
      LIMIT 1
    `;

    const result = await client.query(query, [transaction.invoice_no, transaction.brand_id, transaction.transaction_time, transaction.transaction_type]);
    console.log('Check transaction exists result:', transaction.brand_id);
    return result.rows.length > 0;
  }

  /**
   * Insert a RETURN transaction row.
   *
   * Only fills:
   *   - All identity fields (transaction_id, brand_id, outlet_name etc.)
   *   - transaction_type = 'RETURN'
   *   - salesret_amt     = positive return amount (ABS of INV_AMT)
   *
   * All other amount fields (net_amount, gross_amount etc.) = NULL
   * No items. No payments.
   */
  async insertReturnTransaction(client, transaction) {
    // salesret_amt is always positive
    const salesret_amt = Math.abs(parseFloat(transaction.salesret_amt) || 0);

    const query = `
      INSERT INTO raw_transactions (
        transaction_id, source_transaction_ref, source_system, agent_id, batch_id,
        brand_id, brand_name, outlet_id, outlet_name, terminal, gate,
        transaction_time, transaction_date, shift, shiftdate,
        transaction_type, salesret_amt,
         discount_amount, tax_amount, service_charge,
        fees_amount, net_amount,
        currency, exchange_rate_to_mc, invoice_no
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10, $11,
        $12,
        ($13::timestamptz AT TIME ZONE 'Asia/Kolkata')::date,
        $14, $15,
        $16, $17,
        $18, $19, $20,
        $21, $22,
        $23, $24, $25
      )
    `;

    const values = [
      transaction.transaction_id,
      transaction.source_transaction_ref,
      transaction.source_system,
      transaction.agent_id,
      transaction.batch_id,
      transaction.brand_id,
      transaction.brand_name,
      transaction.outlet_id,
      transaction.outlet_name,
      transaction.terminal,
      transaction.gate,
      transaction.transaction_time,
      transaction.received_at,
      transaction.shift,
      transaction.shiftdate,
      transaction.transaction_type,  // 'RETURN'
      salesret_amt,                  // positive return amount
      transaction.discount_amount ?? null,  // ← was hardcoded NULL
      transaction.tax_amount ?? null,        // ← was hardcoded NULL
      transaction.service_charge ?? null,    // ← was hardcoded NULL
      transaction.fees_amount ?? null,       // ← was hardcoded NULL
      transaction.net_amount ?? null,        // ← was hardcoded NULL    
      transaction.currency,
      transaction.exchange_rate_to_mc,
      transaction.invoice_no
    ];

    await client.query(query, values);
  }

  /**
   * Check if transaction items already exist.
   */
//   async checkItemsExist(client, invoice_no, brand_name, outlet_name) {
//     const query = `
//       SELECT 1 FROM raw_transaction_items
//       WHERE invoice_no  = $1
//         AND brand_name  = $2
//         AND outlet_name = $3
//       LIMIT 1
//     `;

//     const result = await client.query(query, [invoice_no, brand_name, outlet_name]);
//     return result.rows.length > 0;
//   }
 async checkItemsExist(client, invoice_no, brand_id, transaction_time, transtype) {
    const query = `
      SELECT 1 FROM raw_transaction_items
      WHERE invoice_no = $1
      and brand_id  =$2
      and transaction_time =$3
      and transtype =$4
      LIMIT 1
    `;

    const result = await client.query(query, [invoice_no, brand_id, transaction_time, transtype]);
    return result.rows.length > 0;
  }
  /**
   * Check if payments already exist.
   */
//   async checkPaymentsExist(client, invoice_no, brand_name, outlet_name) {
//     const query = `
//       SELECT 1 FROM raw_payment
//       WHERE invoice_no  = $1
//         AND brand_name  = $2
//         AND outlet_name = $3
//       LIMIT 1
//     `;

//     const result = await client.query(query, [invoice_no, brand_name, outlet_name]);
//     return result.rows.length > 0;
//   }

async checkPaymentsExist(client, invoice_no, brand_id, transaction_time, transtype) {
    const query = `
      SELECT 1 FROM raw_payment
      WHERE invoice_no = $1
      and brand_id  =$2
      and transaction_time =$3
      and transtype =$4
      LIMIT 1
    `;

    const result = await client.query(query, [invoice_no, brand_id, transaction_time, transtype]);
    return result.rows.length > 0;
  }
  /**
   * Insert a full SALE transaction row.
   */
  async insertTransaction(client, transaction) {
    const query = `
         INSERT INTO raw_transactions (
      transaction_id, source_transaction_ref, source_system, agent_id, batch_id,
      brand_id, brand_name, outlet_id, outlet_name, terminal, gate,
      transaction_time, transaction_date, shift, shiftdate, salesret_amt,
      transaction_type, discount_amount, tax_amount, service_charge,
      fees_amount, net_amount, currency, exchange_rate_to_mc, payment_summary,
      tender_types, item_count, avg_item_price, customer_type, flight_info,
      tax_breakdown, promo_ids, void_reason, closed_by, device_id, meta, invoice_no
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
      ($13::timestamptz AT TIME ZONE 'Asia/Kolkata')::date, $14, $15, $16,
      $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
      $31, $32, $33, $34, $35, $36, $37
    )
  `;

  const values = [
    transaction.transaction_id,
    transaction.source_transaction_ref,
    transaction.source_system,
    transaction.agent_id,
    transaction.batch_id,
    transaction.brand_id,
    transaction.brand_name,
    transaction.outlet_id,
    transaction.outlet_name,
    transaction.terminal,
    transaction.gate,
    transaction.transaction_time,
    transaction.received_at,
    transaction.shift,
    transaction.shiftdate,
    null,                       // salesret_amt
    transaction.transaction_type,
    transaction.discount_amount,
    transaction.tax_amount,
    transaction.service_charge,
    transaction.fees_amount,
    transaction.net_amount,
    transaction.currency,
    transaction.exchange_rate_to_mc,
    JSON.stringify(transaction.payment_summary),
    transaction.tender_types,
    transaction.item_count,
    transaction.avg_item_price,
    transaction.customer_type,
    JSON.stringify(transaction.flight_info),
    JSON.stringify(transaction.tax_breakdown),
    transaction.promo_ids,
    transaction.void_reason,
    transaction.closed_by,
    transaction.device_id,
    JSON.stringify(transaction.meta),
    transaction.invoice_no
  ];

    await client.query(query, values);
  }

  async insertTransactionItems(client, items, transaction) {
    if (!items || items.length === 0) return;

    // const itemsExist = await this.checkItemsExist(
    //   client,
    //   transaction.invoice_no,
    //   transaction.brand_name,
    //   transaction.outlet_name
    // );
    const itemsExist = await this.checkItemsExist(client, transaction.invoice_no, transaction.brand_id, transaction.transaction_time, transaction.transaction_type);

    if (itemsExist) {
      this.logger.info('Transaction items already exist, skipping', {
        transaction_id: transaction.transaction_id
      });
      return;
    }

    const aggregated = {
      item_line_id:  uuidv4(),
      transaction_id: transaction.transaction_id,
      invoice_no:    transaction.invoice_no,
      brand_id:      transaction.brand_id,
      brand_name:    transaction.brand_name,
      outlet_id:     transaction.outlet_id,
      outlet_name:   transaction.outlet_name,
      terminal:      transaction.terminal,
      gate:          transaction.gate,
      transaction_time: transaction.transaction_time,
      received_at:   transaction.received_at,

      sku:           items.map(i => i.sku),
      item_name:     items.map(i => i.sku_title || i.item_name),
      category:      items.map(i => i.sku_category),
      subcategory:   items.map(i => i.subcategory || null),
      quantity:      items.map(i => Number(i.quantity ?? 1)),
      unit_price:    items.map(i => i.unit_price  == null ? null : Number(i.unit_price)),
      line_total:    items.map(i => i.line_total   == null ? null : Number(i.line_total)),
      line_discount: items.map(i => i.line_discount == null ? null : Number(i.line_discount)),
      line_tax:      items.map(i => i.line_tax     == null ? null : Number(i.line_tax)),
      hsncode:       items.map(i => i.hsncode || null),
      cess:          items.map(i => i.cess || 0),
      taxpercentage: items.map(i => i.taxpercentage || 0),
      cgst:          items.map(i => i.cgst || 0),
      sgst:          items.map(i => i.sgst || 0),
      shiftdate:     transaction.shiftdate,
      shift:         transaction.shift,
      transtype:     transaction.transaction_type
    };

    const query = `
      INSERT INTO raw_transaction_items (
        item_line_id, transaction_id, invoice_no,
        brand_id, brand_name, outlet_id, outlet_name,
        terminal, gate, transaction_time, transaction_date,
        sku, item_name, category, subcategory,
        quantity, unit_price, line_total, line_discount, line_tax,
        taxpercentage, cgst, sgst, shiftdate, shift, transtype, cess, hsncode
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        ($11::timestamptz AT TIME ZONE 'Asia/Kolkata')::date,
        $12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22,$23,$24,$25,$26,$27,$28
      )
    `;

    const values = [
      aggregated.item_line_id,    aggregated.transaction_id,  aggregated.invoice_no,
      aggregated.brand_id,        aggregated.brand_name,      aggregated.outlet_id,
      aggregated.outlet_name,     aggregated.terminal,        aggregated.gate,
      aggregated.transaction_time, aggregated.received_at,
      aggregated.sku,             aggregated.item_name,       aggregated.category,
      aggregated.subcategory,     aggregated.quantity,        aggregated.unit_price,
      aggregated.line_total,      aggregated.line_discount,   aggregated.line_tax,
      aggregated.taxpercentage,   aggregated.cgst,            aggregated.sgst,
      aggregated.shiftdate,       aggregated.shift,           aggregated.transtype,
      aggregated.cess,            aggregated.hsncode
    ];

    await client.query(query, values);
  }

  async insertPayments(client, payments, transaction) {
    if (!payments || payments.length === 0) return;

    // const paymentsExist = await this.checkPaymentsExist(
    //   client,
    //   transaction.invoice_no,
    //   transaction.brand_name,
    //   transaction.outlet_name
    // );
    const paymentsExist = await this.checkPaymentsExist(client, transaction.invoice_no, transaction.brand_id, transaction.transaction_time, transaction.transaction_type);

    if (paymentsExist) {
      this.logger.info('Payments already exist, skipping', {
        transaction_id: payments[0]?.transaction_id
      });
      return;
    }

    for (const payment of payments) {
      const query = `
        INSERT INTO raw_payment (
          payment_id, transaction_id, source_payment_ref, brand_id, brand_name,
          outlet_id, outlet_name, terminal, gate, transaction_time, transaction_date,
          payment_type, amount, card_scheme, issuer_bank, invoice_no, currency,
          exchange_rate_to_mc, meta, shift, shiftdate, transtype
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          ($11::timestamptz AT TIME ZONE 'Asia/Kolkata')::date, $12, $13, $14, $15,
          $16, $17, $18, $19, $20, $21, $22
        )
      `;

      const values = [
        payment.payment_id,          payment.transaction_id,      payment.invoice_no,
        payment.brand_id,            payment.brand_name,          payment.outlet_id,
        payment.outlet_name,         payment.terminal,            payment.gate,
        payment.transaction_time,    payment.received_at,
        payment.payment_type,        payment.amount,              payment.card_scheme,
        payment.issuer_bank,         payment.invoice_no,          payment.currency,
        payment.exchange_rate_to_mc, JSON.stringify(payment.meta),
        payment.shift,               payment.shiftdate,           payment.transtype
      ];

      await client.query(query, values);
    }
  }

  async logException(client, exception) {
    const query = `
      INSERT INTO raw_exceptions (
        transaction_id, brand_id, brand_name, outlet_id, outlet_name,
        event_type, terminal, gate, "user", reason, amount, details
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `;

    const values = [
      exception.transaction_id,  exception.brand_id,    exception.brand_name,
      exception.outlet_id,       exception.outlet_name, exception.event_type,
      exception.terminal,        exception.gate,        exception.user,
      exception.reason,          exception.amount,      JSON.stringify(exception.details)
    ];

    await client.query(query, values);
  }

  async logIngestion(logData) {
    const query = `
      INSERT INTO ingestion_log (
        agent_id, batch_id, source_system, outlet_id, outlet_name,
        brand_id, brand_name, terminal, gate, records_count, errors_count,
        first_received_at, last_received_at, status, meta
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    `;

    const values = [
      logData.agent_id,         logData.batch_id,         logData.source_system,
      logData.outlet_id,        logData.outlet_name,      logData.brand_id,
      logData.brand_name,       logData.terminal,         logData.gate,
      logData.records_count,    logData.errors_count,     logData.first_received_at,
      logData.last_received_at, logData.status,           JSON.stringify(logData.meta)
    ];

    await pool.query(query, values);
  }
}

module.exports = DataInserter;