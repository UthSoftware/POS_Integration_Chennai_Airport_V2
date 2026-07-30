

const axios = require('axios');
const createLogger = require('../config/logger');

/**
 * ZohoInventoryFetcher
 * ─────────────────────────────────────────────────────────────
 * Handles Zoho Inventory API (India data centre — zoho.in)
 *
 * Configured via customer_api_configs row where cac_jsonordb = 'zohoinventory'
 *
 * Required fields in cac_field_mapping (JSON):
 * {
 *   "body": {
 *     "fromdate":        "2026-02-25",        ← start date (YYYY-MM-DD)
 *     "todate":          "2026-02-25",        ← end   date (YYYY-MM-DD)
 *     "refresh_token":   "1000.xxxxx...",     ← Zoho refresh token (never expires)
 *     "client_id":       "1000.WM68V...",     ← Self Client ID
 *     "client_secret":   "adc2e9aa...",       ← Self Client Secret
 *     "organization_id": "60026481635"        ← Zoho org / store ID
 *   }
 * }
 *
 * Optional fields in customer_api_configs:
 *   cac_api_url       → defaults to https://www.zohoapis.in/inventory/v1
 *   cac_authtokenurl  → defaults to https://accounts.zoho.in/oauth/v2/token
 *
 * Output format — array of grouped records (same shape as multiapizoho):
 * [
 *   {
 *     billNumber:  "CHN/25-26/1097",
 *     transaction: { ...invoice header fields },
 *     items:       [ ...line items with brand/category/tax ],
 *     payments:    [ { payment_type, amount, status } ]
 *   },
 *   ...
 * ]
 * ─────────────────────────────────────────────────────────────
 */
class ZohoInventoryFetcher {
  constructor(config) {
    this.config = config;
    this.logger = createLogger('zoho-inventory');

    // ── Parse field mapping ────────────────────────────────────
    let fieldMapping = config.cac_field_mapping;
    if (typeof fieldMapping === 'string') {
      try {
        fieldMapping = JSON.parse(fieldMapping);
      } catch (e) {
        throw new Error(`ZohoInventoryFetcher: Invalid cac_field_mapping JSON — ${e.message}`);
      }
    }
    this.fieldMapping = fieldMapping;

    const body = fieldMapping?.body || {};

    // ── Credentials ───────────────────────────────────────────
    this.refreshToken   = body.refresh_token;
    this.clientId       = body.client_id;
    this.clientSecret   = body.client_secret;
    this.organizationId = body.organization_id;

    // ── Date range ────────────────────────────────────────────
    this.fromDate = body.fromdate;
    this.toDate   = body.todate;

    // ── Endpoints ─────────────────────────────────────────────
    this.tokenUrl = (config.cac_authtokenurl || 'https://accounts.zoho.in/oauth/v2/token').trim();
    this.baseUrl  = (config.cac_api_url       || 'https://www.zohoapis.in/inventory/v1').trim().replace(/\/+$/, '');

    // ── Validate required fields ───────────────────────────────
    const missing = ['refresh_token', 'client_id', 'client_secret', 'organization_id']
      .filter(k => !body[k]);
    if (missing.length) {
      throw new Error(`ZohoInventoryFetcher: Missing in cac_field_mapping.body → ${missing.join(', ')}`);
    }

    // ── Token cache (reuse for 55 min to avoid Zoho rate limits) ──
    this._cachedToken    = null;
    this._tokenExpiresAt = null;
  }

  /* ══════════════════════════════════════════════════════════
     STEP 1 — Get fresh access token using refresh token
     Access token is valid for 1 hour; refresh token never expires
  ══════════════════════════════════════════════════════════ */
  async getAccessToken() {
    // ── Return cached token if still valid (within 55-min window) ──
    const now = Date.now();
    if (this._cachedToken && this._tokenExpiresAt && now < this._tokenExpiresAt) {
      this.logger.info('ZohoInventory: Reusing cached access token');
      return this._cachedToken;
    }

    this.logger.info('ZohoInventory: Requesting access token');

    const form = new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: this.refreshToken,
      client_id:     this.clientId,
      client_secret: this.clientSecret
    });

    const response = await axios.post(this.tokenUrl, form.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000
    });

    const accessToken = response.data?.access_token;
    if (!accessToken) {
      throw new Error(`ZohoInventory: access_token missing in token response — ${JSON.stringify(response.data)}`);
    }

    // Cache for 55 minutes (token lasts 60 min, 5-min safety buffer)
    this._cachedToken    = accessToken;
    this._tokenExpiresAt = now + (55 * 60 * 1000);

    this.logger.info('ZohoInventory: Access token obtained and cached');
    return accessToken;
  }

  /* ══════════════════════════════════════════════════════════
     STEP 2 — Get list of invoices for the date range
     Returns basic invoice info (no line items yet)
  ══════════════════════════════════════════════════════════ */
  async fetchInvoiceList(accessToken, fromDate, toDate) {
    this.logger.info('ZohoInventory: Fetching invoice list', { fromDate, toDate });

    const url = `${this.baseUrl}/invoices`;
    let allInvoices = [];
    let page = 1;
    let hasMore = true;

    // Zoho paginates at 200 per page — loop until all pages fetched
    while (hasMore) {
      const response = await axios.get(url, {
        headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
        params: {
          organization_id: this.organizationId,
          date_start:      fromDate,
          date_end:        toDate,
          per_page:        200,
          page
        },
        timeout: 30000
      });

      if (response.data?.code !== 0) {
        throw new Error(`ZohoInventory invoice list error (code ${response.data?.code}): ${response.data?.message}`);
      }

      const batch = response.data?.invoices || [];
      allInvoices = allInvoices.concat(batch);

      // Stop if we got fewer than 200 (last page)
      hasMore = batch.length === 200;
      page++;
    }

    this.logger.info(`ZohoInventory: Found ${allInvoices.length} invoice(s)`, { fromDate, toDate });
    return allInvoices;
  }

  /* ══════════════════════════════════════════════════════════
     STEP 3 — Get full detail for one invoice (includes line_items)
  ══════════════════════════════════════════════════════════ */
  async fetchInvoiceDetail(accessToken, invoiceId) {
    const url = `${this.baseUrl}/invoices/${invoiceId}`;

    const response = await axios.get(url, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
      params:  { organization_id: this.organizationId },
      timeout: 30000
    });

    if (response.data?.code !== 0) {
      throw new Error(`ZohoInventory invoice detail error (code ${response.data?.code}): ${response.data?.message}`);
    }

    return response.data?.invoice;
  }


  /* ══════════════════════════════════════════════════════════
     HELPER — Strip timezone offset from created_time
     "2026-03-02T09:07:23+0530" → "2026-03-02T09:07:23"
  ══════════════════════════════════════════════════════════ */
  getBillTime(createdTime) {
    if (!createdTime) return null;
    return createdTime.replace(/[+-]\d{2}:?\d{2}$|Z$/, '');
  }

  /* ══════════════════════════════════════════════════════════
     HELPER — Extract custom field value by label from line item
  ══════════════════════════════════════════════════════════ */
  getCustomField(itemCustomFields, label) {
    if (!Array.isArray(itemCustomFields)) return '';
    const field = itemCustomFields.find(f => f.label === label);
    return field?.value || '';
  }

  /* ══════════════════════════════════════════════════════════
     MAIN — fetch everything and return grouped array
  ══════════════════════════════════════════════════════════ */
  async fetchAll(fromDate, toDate) {
    // ── Step 1: Auth ──────────────────────────────────────────
    const accessToken = await this.getAccessToken();

    // ── Step 2: Invoice list ──────────────────────────────────
    const invoiceList = await this.fetchInvoiceList(accessToken, fromDate, toDate);

    if (!invoiceList.length) {
      this.logger.warn('ZohoInventory: No invoices found for date range', { fromDate, toDate });
      return [];
    }

    // ── Step 3: Loop through each invoice for item details ────
    const results = [];

    for (const inv of invoiceList) {
      try {
        const detail = await this.fetchInvoiceDetail(accessToken, inv.invoice_id);

        // ── Build items array from line_items ─────────────────
        const items = (detail.line_items || []).map(item => {
          const cgst = item.line_item_taxes?.find(t => t.tax_specific_type === 'cgst')?.tax_amount || 0;
          const sgst = item.line_item_taxes?.find(t => t.tax_specific_type === 'sgst')?.tax_amount || 0;
          const igst = item.line_item_taxes?.find(t => t.tax_specific_type === 'igst')?.tax_amount || 0;

          return {
            // ── Invoice reference fields ──────────────────────
            invoice_id:     detail.invoice_id,
            invoice_number: detail.invoice_number,
            date:           detail.date,
            created_time:   detail.created_time,
            invoice_no:       detail.invoice_number,   // alias used by FieldMapper
            bill_time:        this.getBillTime(detail.created_time),
            transaction_time: this.getBillTime(detail.created_time),  // direct alias — avoids mapping lookup issues

            // ── Item identification ───────────────────────────
            item_id:        item.item_id,
            sku:            item.sku,
            name:           item.name,
            hsn_or_sac:     item.hsn_or_sac || '',

            // ── Quantity & pricing ────────────────────────────
            quantity:       item.quantity,
            rate:           item.rate,           // selling price (incl. tax)
            purchase_rate:  item.purchase_rate,  // cost price
            item_total:     item.item_total,     // excl. tax total for this line

            // ── Tax breakdown ─────────────────────────────────
            tax_percentage: item.tax_percentage || 0,
            cgst,
            sgst,
            igst,
            line_tax:       Math.round((cgst + sgst + igst) * 100) / 100,  // sum of all taxes

            // ── Custom fields ─────────────────────────────────
            brand:    this.getCustomField(item.item_custom_fields, 'Brand'),
            category: this.getCustomField(item.item_custom_fields, 'Category'),
            variant:  this.getCustomField(item.item_custom_fields, 'Variant'),
            handle:   this.getCustomField(item.item_custom_fields, 'Handle'),
            tags:     this.getCustomField(item.item_custom_fields, 'Tags'),

            // ── Warehouse ─────────────────────────────────────
            warehouse_name: item.warehouse_name || ''
          };
        });

        // ── Build grouped record ──────────────────────────────
        // NOTE: Transaction fields are hoisted to the TOP LEVEL of the record
        // so that FieldMapper (row_root=NULL) can read them as flat fields.
        // The nested `transaction` object is kept for reference/logging only.
        const grouped = {
          // ── Key used by FieldMapper / grouping ────────────────
          billNumber: detail.invoice_number,

          // ── Transaction fields FLAT at root level ─────────────
          // FieldMapper with pvfm_row_root_json_path=NULL reads these directly
          invoice_id:       detail.invoice_id,
          invoice_number:   detail.invoice_number,
          invoice_no:       detail.invoice_number,
          date:             detail.date,
          created_time:     detail.created_time,
          bill_time:        this.getBillTime(detail.created_time),
          customer_name:    detail.customer_name,
          status:           detail.status,
          salesperson_name: detail.salesperson_name || '',
          branch_name:      detail.branch_name || '',
          place_of_supply:  detail.place_of_supply || '',
          total:            detail.total,
          sub_total:        detail.sub_total,
          tax_total:        detail.tax_total,
          discount_total:   detail.discount_total || 0,
          payment_made:     detail.payment_made || 0,
          balance:          detail.balance || 0,

          // ── Nested transaction object (kept for reference) ─────
          transaction: {
            invoice_id:       detail.invoice_id,
            invoice_number:   detail.invoice_number,
            date:             detail.date,
            created_time:     detail.created_time,
            customer_name:    detail.customer_name,
            status:           detail.status,
            salesperson_name: detail.salesperson_name || '',
            branch_name:      detail.branch_name || '',
            place_of_supply:  detail.place_of_supply || '',
            total:            detail.total,
            sub_total:        detail.sub_total,
            tax_total:        detail.tax_total,
            discount_total:   detail.discount_total || 0,
            payment_made:     detail.payment_made || 0,
            balance:          detail.balance || 0,
            bill_time:        this.getBillTime(detail.created_time)
          },

          // ── Line items (built above) ───────────────────────────
          items,

          // Payment — Zoho Inventory doesn't have a separate payments endpoint;
          // we synthesise one entry from the invoice total
          payments: [{
            invoice_id:     detail.invoice_id,
            invoice_number: detail.invoice_number,
            date:           detail.date,
            created_time:   detail.created_time,
            invoice_no:     detail.invoice_number,   // alias used by FieldMapper
            payment_type:   detail.status === 'paid' ? 'SALE' : 'PENDING',
            amount:         detail.total,
            payment_made:   detail.payment_made || 0,
            status:         detail.status,
            bill_time:      this.getBillTime(detail.created_time)
          }]
        };

        results.push(grouped);
        this.logger.info(`ZohoInventory: Processed invoice ${detail.invoice_number} (${items.length} item(s))`);

      } catch (err) {
        this.logger.error(`ZohoInventory: Failed to fetch detail for invoice ${inv.invoice_id}`, {
          invoice_number: inv.invoice_number,
          error: err.message
        });
        // Continue with next invoice — don't abort the whole batch
      }
    }

    this.logger.info(`ZohoInventory: Completed — ${results.length} invoice(s) processed`);
    return results;
  }
}

module.exports = ZohoInventoryFetcher;