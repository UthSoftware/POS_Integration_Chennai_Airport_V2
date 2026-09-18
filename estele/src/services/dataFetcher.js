const DatabaseConnector = require('../database/connector');
const fileReader = require('../utils/fileReader');
const cloudPoster = require('./cloudPoster');
const logger = require('../config/logger');
const axios = require('axios');
const xml2js = require('xml2js');
const fs = require('fs');

// Safely convert any value to a numeric string, never "NaN".
// Prevents malformed numeric fields (e.g. bad TOTALDISCOUNT from Tally)
// from breaking downstream inserts and aborting the whole transaction.
function safeNum(value, fallback = 0) {
  const n = parseFloat(value);
  return String(Number.isFinite(n) ? Math.abs(n) : fallback);
}

class DataFetcher {
  async fetchAndPost() {
    const connector = new DatabaseConnector();

    try {
      logger.info('Starting data fetch cycle');

      const dbDetailsFile = process.env.DB_DETAILS_FILE || './config/db_details.txt';
      const dbConfig = await fileReader.readDbDetails(dbDetailsFile);

      // DATE LOGIC - For SOAP or Tally connections, use today's date range
      // by default. Set FROM_DATE / TO_DATE env vars to override with a
      // custom fixed range (e.g. for backfills), instead of hardcoding it here.
      if (dbConfig.connectionType === 'soap' || dbConfig.connectionType === 'tally') {
        let dates;

        if (process.env.FROM_DATE && process.env.TO_DATE) {
          dates = this.getCustomDateRange(process.env.FROM_DATE, process.env.TO_DATE);
          logger.info('Using custom date range from env vars', dates);
        } else {
          dates = this.getTodayDateRange();
          logger.info('Using today\'s date range', dates);
        }

        dbConfig.fromDate = dates.fromDate;
        dbConfig.toDate = dates.toDate;
      }

      let results;
      let metadata;

      // Check connection type: SOAP, Tally, or Database
      if (dbConfig.connectionType === 'tally') {
        // Tally REST API Connection
        logger.info('Using Tally REST API connection', {
          vendor: dbConfig.vendorName,
          tallyApiUrl: dbConfig.tallyApiUrl,
          fromDate: dbConfig.fromDate,
          toDate: dbConfig.toDate
        });

        results = await this.fetchFromTally(dbConfig);

        metadata = {
          connectionType: 'tally',
          vendor: dbConfig.vendorName,
          vendorid: dbConfig.vendorid,
          fromDate: dbConfig.fromDate,
          toDate: dbConfig.toDate,
          fetchedAt: new Date().toISOString()
        };
      } else if (dbConfig.connectionType === 'soap') {
        // SOAP API Connection (eShopaid)
        logger.info('Using SOAP connection', {
          vendor: dbConfig.vendorName,
          soapUrl: dbConfig.soapUrl,
          fromDate: dbConfig.fromDate,
          toDate: dbConfig.toDate
        });

        results = await this.fetchFromSOAP(dbConfig);

        metadata = {
          connectionType: 'soap',
          vendor: dbConfig.vendorName,
          vendorid: dbConfig.vendorid,
          fromDate: dbConfig.fromDate,
          toDate: dbConfig.toDate,
          fetchedAt: new Date().toISOString()
        };
      } else {
        // Database Connection (MySQL, Oracle, HANA, etc.)
        logger.info('Using database connection', {
          dbType: dbConfig.dbType,
          server: dbConfig.server
        });

        const queryFile = process.env.QUERY_FILE || './config/query.txt';
        const query = await fileReader.readQuery(queryFile);

        await connector.connect(dbConfig);
        results = await connector.executeQuery(query);

        metadata = {
          connectionType: 'database',
          dbType: dbConfig.dbType,
          server: dbConfig.server,
          database: dbConfig.database,
          vendorid: dbConfig.vendorid,
          fetchedAt: new Date().toISOString()
        };
      }

      if (!results || (Array.isArray(results) && results.length === 0)) {
        logger.warn('No data fetched');
        return { success: true, recordCount: 0 };
      }

      logger.info('Data fetched successfully', {
        type: dbConfig.connectionType || 'database',
        recordCount: Array.isArray(results) ? results.length : 1
      });

      // PRETTY PRINT - Log sample of GROUPED data
      if (Array.isArray(results) && results.length > 0) {
        console.log('\n' + '='.repeat(80));
        console.log('📦 GROUPED DATA SAMPLE (First 3 receipts)');
        console.log('='.repeat(80));

        const sample = results.slice(0, 3);
        sample.forEach((receipt, index) => {
          console.log(`\n🧾 Receipt #${index + 1}: ${receipt.receipt_no}`);
          console.log('─'.repeat(80));
          console.log('Transaction:', JSON.stringify(receipt.transaction, null, 2));
          console.log(`Items (${receipt.items?.length || 0}):`, JSON.stringify(receipt.items, null, 2));
          console.log(`Payments (${receipt.payments?.length || 0}):`, JSON.stringify(receipt.payments, null, 2));
        });

        console.log('\n' + '='.repeat(80));
        console.log(`📊 Total Receipts: ${results.length}`);
        console.log('='.repeat(80) + '\n');
      }

      const postResult = await cloudPoster.postData(results, metadata);

      logger.info('Fetch and post cycle completed', {
        recordCount: Array.isArray(results) ? results.length : 1,
        postStatus: postResult.status
      });

      return {
        success: true,
        recordCount: Array.isArray(results) ? results.length : 1,
        postResult: postResult
      };

    } catch (error) {
      logger.error('Fetch and post cycle failed', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    } finally {
      await connector.close();
    }
  }

  // Fetch from Tally REST API
  async fetchFromTally(tallyConfig) {
    try {
      // Format dates for Tally API (YYYYMMDD format)
      const fromDate = tallyConfig.fromDate.replace(/[-T:]/g, '').substring(0, 8);
      const toDate = tallyConfig.toDate.replace(/[-T:]/g, '').substring(0, 8);

      // Build URL with date parameters
      const url = `${tallyConfig.tallyApiUrl}?fromDate=${fromDate}&toDate=${toDate}`;

      logger.info('Fetching from Tally API', {
        url: url,
        fromDate: fromDate,
        toDate: toDate
      });

      const response = await axios.get(url, {
        timeout: tallyConfig.timeout || 60000,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.data || !response.data.tally) {
        logger.warn('No tally data in response');
        return [];
      }

      logger.info('Tally data fetched successfully', {
        billCount: response.data.tally.length
      });

      // Transform Tally data to grouped receipt format
      const transformedData = this.transformTallyData(response.data.tally);

      return transformedData;

    } catch (error) {
      logger.error('Tally API fetch failed', {
        error: error.message,
        response: error.response?.data
      });
      throw new Error(`Tally API Error: ${error.message}`);
    }
  }

  // Transform Tally bills to receipt format
  transformTallyData(tallyBills) {
    logger.info('Transforming Tally data', { billCount: tallyBills.length });

    const transformed = tallyBills.map(bill => {
      // Parse date from "5-Jan-26" to ISO format
      const billDate = this.parseTallyDate(bill.MBILLDATE);

      return {
        receipt_no: bill.BILLNUMBER,
        transaction: {
          RECORD_TYPE: 'G100',
          POS_TILL: bill.STOREID || '',
          SHIFT_NO: '',
          RECEIPT_NO: bill.BILLNUMBER,
          TIMESTAMP: billDate,
          INV_AMT: safeNum(bill.BILLAMT, 0),
          TAX_AMT: safeNum(bill.BILLTAX, 0),
          DIS_AMT: safeNum(bill.TOTALDISCOUNT, 0),
          NET_AMT: safeNum(bill.BILLGROSS, 0),
          RET_AMT: '0',
          CUST_NAME: '',
          TRANSACTION_STATUS: bill.BILLTYPE === 'Sales' ? 'SALES' : 'RETURN'
        },
        items: [], // Tally doesn't provide item-level data in this response
        payments: [{
          RECORD_TYPE: 'G115',
          RECEIPT_NO: bill.BILLNUMBER,
          TIMESTAMP: billDate,
          PAYMENT_NAME: 'CASH', // Default payment method
          CURR_CODE: '1',
          EXCHANGE_RATE: '1',
          AMOUNT: safeNum(bill.BILLAMT, 0),
          TRANSACTION_STATUS: bill.BILLTYPE === 'Sales' ? 'SALES' : 'RETURN'
        }]
      };
    });

    logger.info('Tally data transformed', { receiptCount: transformed.length });
    return transformed;
  }

  // Parse Tally date format "5-Jan-26" to ISO
  parseTallyDate(dateStr) {
    try {
      const months = {
        'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
        'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
        'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
      };

      const parts = dateStr.split('-');
      const day = parts[0].padStart(2, '0');
      const month = months[parts[1]];
      const year = '20' + parts[2]; // Convert "26" to "2026"

      return `${year}-${month}-${day}T00:00:00`;
    } catch (error) {
      logger.warn('Failed to parse Tally date', { dateStr });
      return new Date().toISOString();
    }
  }

  // Get today's date range (00:00:00 to 23:59:59)
  getTodayDateRange() {
    const now = new Date();

    // Start of today (00:00:00)
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);

    // End of today (23:59:59)
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    // Format as ISO string and convert to required format
    const fromDate = this.formatDateForSOAP(startOfDay);
    const toDate = this.formatDateForSOAP(endOfDay);

    return { fromDate, toDate };
  }

  // Get a custom fixed date range (00:00:00 to 23:59:59)
  // fromDateStr and toDateStr must be in 'YYYY-MM-DD' format
  getCustomDateRange(fromDateStr, toDateStr) {
    const fromParts = fromDateStr.split('-').map(Number);
    const toParts = toDateStr.split('-').map(Number);

    const startOfRange = new Date(fromParts[0], fromParts[1] - 1, fromParts[2], 0, 0, 0);
    const endOfRange = new Date(toParts[0], toParts[1] - 1, toParts[2], 23, 59, 59);

    const fromDate = this.formatDateForSOAP(startOfRange);
    const toDate = this.formatDateForSOAP(endOfRange);

    return { fromDate, toDate };
  }

  // Format date for SOAP API (YYYY-MM-DDTHH:mm:ss)
  formatDateForSOAP(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
  }

  // SOAP FETCHER - Returns GROUPED data by receipt number
  async fetchFromSOAP(soapConfig) {
    logger.info('Fetching SOAP segments', {
      fromDate: soapConfig.fromDate,
      toDate: soapConfig.toDate
    });

    const [
      transactionSegment,
      itemSegment,
      paymentSegment
    ] = await Promise.all([
      this.callSoapMethod('TransactionSegment', soapConfig),
      this.callSoapMethod('ItemSegment', soapConfig),
      this.callSoapMethod('PaymentSegment', soapConfig)
    ]);

    const soapData = {
      transactionSegment: transactionSegment,
      itemSegment: itemSegment,
      paymentSegment: paymentSegment
    };

    // Group by receipt number
    const groupedData = this.groupByReceiptNoFromSoap(soapData);

    logger.info('SOAP data grouped by receipt number', {
      totalReceipts: groupedData.length
    });

    return groupedData;
  }

  // Grouping function (with proper field mapping and NaN-safe numeric fields)
  groupByReceiptNoFromSoap(data) {
    const { transactions, items, payments } =
      this.extractArraysFromSoapResponse(data);

    logger.info('Arrays extracted for grouping', {
      transactionCount: transactions.length,
      itemCount: items.length,
      paymentCount: payments.length
    });

    const grouped = {};

    // Transactions (base)
    for (const tx of transactions) {
      const receipt = tx.RECEIPT_NO;
      if (!receipt) continue;

      grouped[receipt] = {
        receipt_no: receipt,
        transaction: {
          RECORD_TYPE: 'G100',
          POS_TILL: tx.POS_TILL || '',
          SHIFT_NO: tx.SHIFT_NO || '',
          RECEIPT_NO: receipt,
          TIMESTAMP: tx.TIMESTAMP || new Date().toISOString(),
          INV_AMT: safeNum(tx.INV_AMT, 0),
          TAX_AMT: safeNum(tx.TAX_AMT, 0),
          DIS_AMT: safeNum(tx.DIS_AMT, 0),
          NET_AMT: safeNum(tx.NET_AMT, 0),
          RET_AMT: safeNum(tx.RET_AMT, 0),
          CUST_NAME: tx.CUST_NAME || '',
          TRANSACTION_STATUS: tx.TRANSACTION_STATUS || 'SALES'
        },
        items: [],
        payments: []
      };
    }

    // Items
    for (const item of items) {
      const receipt = item.RECEIPT_NO;
      if (!receipt) continue;

      if (!grouped[receipt]) {
        grouped[receipt] = {
          receipt_no: receipt,
          transaction: null,
          items: [],
          payments: []
        };
      }

      grouped[receipt].items.push({
        RECORD_TYPE: 'G111',
        RECEIPT_NO: receipt,
        TIMESTAMP: item.TIMESTAMP || new Date().toISOString(),
        ITEM_CODE: item.ITEM_CODE || '',
        ITEM_NAME: item.ITEM_NAME || '',
        ITEM_QTY: safeNum(item.ITEM_QTY, 0),
        ITEM_PRICE: safeNum(item.ITEM_PRICE, 0),
        ITEM_CATG: item.ITEM_CATG || '',
        TAX_NAME: item.TAX_NAME || '',
        TAX_AMT: safeNum(item.TAX_AMT, 0),
        DISC_AMT: safeNum(item.DISC_AMT, 0),
        TAX_TYPE: item.TAX_TYPE || '',
        NET_AMT: safeNum(item.NET_AMT, 0),
        TRANSACTION_STATUS: item.TRANSACTION_STATUS || 'SALES'
      });
    }

    // Payments
    for (const pay of payments) {
      const receipt = pay.RECEIPT_NO;
      if (!receipt) continue;

      if (!grouped[receipt]) {
        grouped[receipt] = {
          receipt_no: receipt,
          transaction: null,
          items: [],
          payments: []
        };
      }

      grouped[receipt].payments.push({
        RECORD_TYPE: 'G115',
        RECEIPT_NO: receipt,
        TIMESTAMP: pay.TIMESTAMP || new Date().toISOString(),
        PAYMENT_NAME: pay.PAYMENT_NAME || '',
        CURR_CODE: pay.CURR_CODE || '1',
        EXCHANGE_RATE: safeNum(pay.EXCHANGE_RATE, 1),
        AMOUNT: safeNum(pay.AMOUNT, 0),
        TRANSACTION_STATUS: pay.TRANSACTION_STATUS || 'SALES'
      });
    }

    const groupedArray = Object.values(grouped);

    logger.info('Grouped SOAP data by receipt no', {
      totalReceipts: groupedArray.length,
      transactionCount: transactions.length,
      itemCount: items.length,
      paymentCount: payments.length
    });

    return groupedArray;
  }

  // Extract arrays from PARSED SOAP response
  extractArraysFromSoapResponse(data) {
    const transactions =
      data?.transactionSegment?.diffgram?.eShopaidTransactionSegment?.TransactionSegment || [];

    const items =
      data?.itemSegment?.diffgram?.eShopaidItemSegment?.ItemSegment || [];

    const payments =
      data?.paymentSegment?.diffgram?.NewDataSet?.Table || [];

    logger.info('Extracted SOAP arrays', {
      transactionsFound: Array.isArray(transactions) ? transactions.length : (transactions ? 1 : 0),
      itemsFound: Array.isArray(items) ? items.length : (items ? 1 : 0),
      paymentsFound: Array.isArray(payments) ? payments.length : (payments ? 1 : 0)
    });

    return {
      transactions: Array.isArray(transactions) ? transactions : (transactions ? [transactions] : []),
      items: Array.isArray(items) ? items : (items ? [items] : []),
      payments: Array.isArray(payments) ? payments : (payments ? [payments] : [])
    };
  }

  buildSoapEnvelope(methodName, soapConfig, optionalData = '') {
    return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:esh="http://eshopaid.in">

  <soapenv:Header>
    <esh:eShopaidSoapHeader>
      <esh:UserName>${soapConfig.username}</esh:UserName>
      <esh:Password>${soapConfig.password}</esh:Password>
      <esh:MethodName>${methodName}</esh:MethodName>
      <esh:FromDate>${soapConfig.fromDate}</esh:FromDate>
      <esh:ToDate>${soapConfig.toDate}</esh:ToDate>
      <esh:OptionalData>${optionalData}</esh:OptionalData>
    </esh:eShopaidSoapHeader>
  </soapenv:Header>

  <soapenv:Body>
    <esh:GetResponseAsDataSet />
  </soapenv:Body>

</soapenv:Envelope>`;
  }

  async callSoapMethod(methodName, soapConfig) {
    try {
      const soapEnvelope = this.buildSoapEnvelope(methodName, soapConfig);

      logger.info('Calling SOAP method', {
        method: methodName,
        url: soapConfig.soapUrl
      });

      const response = await axios.post(
        soapConfig.soapUrl,
        soapEnvelope,
        {
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            'SOAPAction': 'http://eshopaid.in/GetResponseAsDataSet'
          },
          timeout: soapConfig.timeout || 60000
        }
      );

      // Log raw SOAP response to file
      const logsDir = './logs';
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      fs.appendFileSync(
        'logs/soap.log',
        `===== ${methodName} - ${new Date().toISOString()} =====\n${response.data}\n\n`
      );

      logger.info('SOAP method called successfully', { method: methodName });

      return await this.parseSoapResponse(response.data);

    } catch (error) {
      logger.error('SOAP call failed', {
        method: methodName,
        error: error.message,
        response: error.response?.data
      });
      throw new Error(`[${methodName}] ${error.response?.data || error.message}`);
    }
  }

  // Parse SOAP response and return clean structure
  async parseSoapResponse(xml) {
    try {
      const parser = new xml2js.Parser({
        explicitArray: false,
        ignoreAttrs: true,
        tagNameProcessors: [xml2js.processors.stripPrefix]
      });

      const result = await parser.parseStringPromise(xml);

      const body = result.Envelope?.Body;
      const response = body?.GetResponseAsDataSetResponse;
      const dataSet = response?.GetResponseAsDataSetResult;

      if (dataSet) {
        logger.info('SOAP response parsed successfully');
        return dataSet;
      }

      logger.warn('No dataset found in SOAP response, returning full result');
      return result;

    } catch (error) {
      logger.error('XML parsing failed', { error: error.message });
      throw new Error(`XML Parse Error: ${error.message}`);
    }
  }
}

module.exports = new DataFetcher();