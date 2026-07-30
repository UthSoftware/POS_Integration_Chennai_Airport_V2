// const pool = require('../config/database');
// const ConfigModel = require('../models/configModel');
// const createLogger = require('../config/logger');

// const logger = createLogger('transaction-count-service');

// class TransactionCountService {

//   /**
//   * Get transaction count from OUR database for a given vendorid + date.
//   * Uses brand_id resolved from the vendor config mapping.
//   *
//   * @param {string} vendorid  - the vendor's ID (from db_details.txt vendorid field)
//   * @param {string} date      - YYYY-MM-DD
//   * @returns {{ brand_id, brand_name, terminal, date, count }}
//   */
//   async getCountForDate(vendorid, date) {
//     try {
//       // Resolve config so we know brand_id, brand_name, terminal for this vendor
//       const config = await ConfigModel.getConfigById(vendorid);
//       if (!config) {
//         throw new Error(`No active config found for vendorid: ${vendorid}`);
//       }

//       const brand_id   = config.com_brand_id;
//       const brand_name = config.brand_name;
//       const terminal   = config.com_terminal;

//       logger.info('Fetching server-side transaction count', {
//         vendorid, brand_id, brand_name, terminal, date
//       });

//       // Count distinct invoice_no in raw_transactions for this brand + date
//       const query = `
//         SELECT COUNT(DISTINCT invoice_no)::int AS count
//         FROM raw_transactions
//         WHERE brand_id       = $1
//           AND transaction_date = $2::date
//       `;

//       const result = await pool.query(query, [brand_id, date]);
//       const count  = result.rows[0]?.count ?? 0;

//       logger.info('Server-side count fetched', {
//         vendorid, brand_id, date, count
//       });

//       return { brand_id, brand_name, terminal, date, count };

//     } catch (error) {
//       logger.error('Failed to get transaction count', {
//         vendorid, date, error: error.message
//       });
//       throw error;
//     }
//   }

//   /**
//   * Returns the vendor's raw column names for invoice and date fields,
//   * resolved from pos_vendor_field_mapping.
//   * The client needs these to build its count query against the vendor DB.
//   *
//   * For DB-type vendors  → pvfm_target_field
//   * For JSON/API vendors → pvfm_json_path
//   *
//   * Also returns cac_jsonordb so the client knows which mode to use.
//   *
//   * @param {string} vendorid
//   * @returns {{ invoice_col, date_col, source_type, brand_id, brand_name, terminal }}
//   */
//   async getFieldInfo(vendorid) {
//     try {
//       const config = await ConfigModel.getConfigById(vendorid);
//       if (!config) {
//         throw new Error(`No active config found for vendorid: ${vendorid}`);
//       }

//       const fieldMappings = await ConfigModel.getAllFieldMappings(config.cac_customer_id);
//       const txMappings    = fieldMappings.raw_transactions;

//       const source_type = (config.cac_jsonordb || 'db').toLowerCase();
//       const isJsonMode  = ['api', 'json', 'xml', 'soap'].includes(source_type);

//       // Find invoice_no mapping
//       const invoiceMapping = txMappings.find(m => m.pvfm_source_field === 'invoice_no');
//       if (!invoiceMapping) {
//         throw new Error(`invoice_no mapping not found for vendor: ${vendorid}`);
//       }

//       // Find transaction_time (or transaction_date) mapping — this holds the date
//       // Some vendors map date+time together via pvfm_target_field = 'DateCol|TimeCol'
//       const dateMapping = txMappings.find(
//         m => m.pvfm_source_field === 'transaction_time' ||
//              m.pvfm_source_field === 'transaction_date'
//       );
//       if (!dateMapping) {
//         throw new Error(`transaction_time/date mapping not found for vendor: ${vendorid}`);
//       }

//       let invoice_col, date_col;

//       if (isJsonMode) {
//         invoice_col = invoiceMapping.pvfm_json_path;
//         date_col    = dateMapping.pvfm_json_path;
//       } else {
//         invoice_col = invoiceMapping.pvfm_target_field;
//         // Handle 'DateCol|TimeCol' pattern — we only need the date part
//         const rawDateField = dateMapping.pvfm_target_field || '';
//         date_col = rawDateField.includes('|')
//           ? rawDateField.split('|')[0]   // e.g. 'Date' from 'Date|TimeofSale'
//           : rawDateField;
//       }

//       logger.info('Field info resolved for vendor', {
//         vendorid,
//         invoice_col,
//         date_col,
//         source_type
//       });

//       return {
//         invoice_col,
//         date_col,
//         source_type,
//         brand_id   : config.com_brand_id,
//         brand_name : config.brand_name,
//         terminal   : config.com_terminal
//       };

//     } catch (error) {
//       logger.error('Failed to get field info', { vendorid, error: error.message });
//       throw error;
//     }
//   }
// }

// module.exports = new TransactionCountService();



const pool = require('../config/database');
const createLogger = require('../config/logger');

const logger = createLogger('transaction-count-service');

/**
 * TransactionCountService
 * ────────────────────────
 * Queries the SERVER-side DB to support reconciliation.
 *
 * Table / column reference (verified against live schema CSVs):
 *
 *  customer_outlet_mapping  (alias: com)
 *    com_customer_id   → the vendorid used in db_details.txt
 *    com_brand_id      → brand identifier stored in raw_transactions.brand_id
 *    com_terminal      → terminal identifier
 *    brand_name        → human-readable brand name
 *    com_vendorname    → vendor display name
 *    com_is_active     → boolean active flag
 *
 *  customer_api_configs  (alias: cac)
 *    cac_customer_id   → joins to com_customer_id
 *    cac_jsonordb      → 'db' | 'api' | 'json' | 'xml' | 'soap'
 *    cac_is_active     → boolean active flag
 *
 *  pos_vendor_field_mapping  (alias: pvfm)
 *    pvfm_vendor_id        → joins to com_customer_id
 *    pvfm_source_field     → our canonical field name (e.g. 'invoice_no', 'transaction_time')
 *    pvfm_target_field     → vendor DB column name (DB mode)
 *    pvfm_json_path        → JSON path (API/JSON mode)
 *    pvfm_tablename        → target table ('raw_transactions', 'raw_transaction_items', …)
 *
 *  raw_transactions
 *    brand_id          → matches com_brand_id
 *    transaction_date  → DATE column (used for server-side count)
 *    invoice_no        → distinct invoice identifier
 */
class TransactionCountService {

  // ─────────────────────────────────────────────────
  //  INTERNAL: resolve com + cac for a vendorid
  //  Returns: { com_brand_id, com_terminal, brand_name, com_vendorname,
  //             cac_jsonordb, cac_customer_id }
  // ─────────────────────────────────────────────────
  async _resolveVendorConfig(vendorid) {
    // Join customer_outlet_mapping with customer_api_configs.
    // customer_api_configs may have multiple rows per vendor (one per outlet/terminal);
    // we pick the most-recently-updated active config, falling back to any active row.
    const query = `
      SELECT
        com.com_customer_id,
        com.com_brand_id,
        com.com_terminal,
        com.brand_name,
        com.com_vendorname,
        cac.cac_jsonordb,
        cac.cac_customer_id
      FROM customer_outlet_mapping AS com
      LEFT JOIN customer_api_configs AS cac
        ON cac.cac_customer_id = com.com_customer_id
       AND cac.cac_is_active = TRUE
      WHERE com.com_customer_id = $1
        AND com.com_is_active   = TRUE
      ORDER BY cac.cac_updated_at DESC NULLS LAST
      LIMIT 1
    `;

    const result = await pool.query(query, [vendorid]);
    if (!result.rows.length) {
      throw new Error(
        `No active config found in customer_outlet_mapping for vendorid: ${vendorid}`
      );
    }
    return result.rows[0];
  }

  // ─────────────────────────────────────────────────
  //  INTERNAL: fetch all raw_transactions field mappings for a vendor
  // ─────────────────────────────────────────────────
  async _resolveFieldMappings(vendorid) {
    const query = `
      SELECT
        pvfm_source_field,
        pvfm_target_field,
        pvfm_json_path,
        pvfm_tablename
      FROM pos_vendor_field_mapping
      WHERE pvfm_vendor_id  = $1
        AND pvfm_tablename  = 'raw_transactions'
    `;
    const result = await pool.query(query, [vendorid]);
    return result.rows; // array of mapping rows
  }

  // ─────────────────────────────────────────────────
  //  PUBLIC: server-side transaction count for vendorid + date
  //
  //  Returns: { brand_id, brand_name, terminal, date, count }
  // ─────────────────────────────────────────────────
  async getCountForDate(vendorid, date) {
    try {
      const config = await this._resolveVendorConfig(vendorid);

      const brand_id   = config.com_brand_id;
      const brand_name = config.brand_name;
      const terminal   = config.com_terminal;

      logger.info('Fetching server-side transaction count', {
        vendorid, brand_id, brand_name, terminal, date
      });

      // raw_transactions uses:
      //   brand_id         → com_brand_id
      //   transaction_date → proper DATE column (NOT transaction_time)
      //   invoice_no       → distinct invoice identifier
      const query = `
        SELECT COUNT(DISTINCT invoice_no)::int AS count
        FROM raw_transactions
        WHERE brand_id         = $1
          AND transaction_date = $2::date
      `;

      const result = await pool.query(query, [brand_id, date]);
      const count  = result.rows[0]?.count ?? 0;

      logger.info('Server-side count fetched', { vendorid, brand_id, date, count });

      return { brand_id, brand_name, terminal, date, count };

    } catch (error) {
      logger.error('Failed to get transaction count', {
        vendorid, date, error: error.message
      });
      throw error;
    }
  }

  // ─────────────────────────────────────────────────
  //  PUBLIC: resolve vendor column names for invoice + date
  //  so the CLIENT can build its own count query.
  //
  //  Returns:
  //    { invoice_col, date_col, source_type,
  //      brand_id, brand_name, terminal }
  // ─────────────────────────────────────────────────
  async getFieldInfo(vendorid) {
    try {
      const config = await this._resolveVendorConfig(vendorid);

      const source_type = (config.cac_jsonordb || 'db').toLowerCase();
      const isJsonMode  = ['api', 'json', 'xml', 'soap'].includes(source_type);

      const mappings = await this._resolveFieldMappings(vendorid);

      if (!mappings.length) {
        throw new Error(
          `No field mappings found in pos_vendor_field_mapping for vendorid: ${vendorid} / table: raw_transactions`
        );
      }

      // ── invoice_no ──
      const invoiceMapping = mappings.find(
        m => m.pvfm_source_field === 'invoice_no'
      );
      if (!invoiceMapping) {
        throw new Error(`invoice_no mapping not found for vendorid: ${vendorid}`);
      }

      // ── date field: prefer transaction_time, fall back to transaction_date ──
      // transaction_time is the POS timestamp; transaction_date is the derived date.
      // The client count query casts to DATE, so either works.
      const dateMapping =
        mappings.find(m => m.pvfm_source_field === 'transaction_time') ||
        mappings.find(m => m.pvfm_source_field === 'transaction_date');

      if (!dateMapping) {
        throw new Error(
          `Neither transaction_time nor transaction_date mapping found for vendorid: ${vendorid}`
        );
      }

      let invoice_col, date_col;

      if (isJsonMode) {
        invoice_col = invoiceMapping.pvfm_json_path;
        date_col    = dateMapping.pvfm_json_path;
      } else {
        invoice_col = invoiceMapping.pvfm_target_field;

        // Some vendors store 'DateCol|TimeCol' in pvfm_target_field.
        // We only need the date part for the WHERE clause.
        const rawDateField = dateMapping.pvfm_target_field || '';
        date_col = rawDateField.includes('|')
          ? rawDateField.split('|')[0]   // e.g. 'SaleDate' from 'SaleDate|SaleTime'
          : rawDateField;
      }

      logger.info('Field info resolved for vendor', {
        vendorid, invoice_col, date_col, source_type
      });

      return {
        invoice_col,
        date_col,
        source_type,
        brand_id   : config.com_brand_id,
        brand_name : config.brand_name,
        terminal   : config.com_terminal
      };

    } catch (error) {
      logger.error('Failed to get field info', { vendorid, error: error.message });
      throw error;
    }
  }
}

module.exports = new TransactionCountService();