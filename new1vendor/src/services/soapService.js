const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config/soap.config');
const { parseSoapResponse } = require('../utils/xmlParser');
const logger = require('../config/logger');

class SoapService {
  constructor() {
    this.soapUrl = config.SOAP_URL;
    this.soapAction = config.SOAP_ACTION;
    this.auth = config.AUTH;
    this.timeout = config.TIMEOUT;
  }

  buildSoapEnvelope(methodName, fromDate, toDate, optionalData = '') {
    return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:esh="http://eshopaid.in">
  <soapenv:Header>
    <esh:eShopaidSoapHeader>
      <esh:UserName>${this.auth.USERNAME}</esh:UserName>
      <esh:Password>${this.auth.PASSWORD}</esh:Password>
      <esh:MethodName>${methodName}</esh:MethodName>
      <esh:FromDate>${fromDate}</esh:FromDate>
      <esh:ToDate>${toDate}</esh:ToDate>
      <esh:OptionalData>${optionalData}</esh:OptionalData>
    </esh:eShopaidSoapHeader>
  </soapenv:Header>
  <soapenv:Body>
    <esh:GetResponseAsDataSet />
  </soapenv:Body>
</soapenv:Envelope>`;
  }

  async callSoapMethod(methodName, fromDate, toDate, optionalData = '') {
    try {
      const soapEnvelope = this.buildSoapEnvelope(methodName, fromDate, toDate, optionalData);

      logger.info(`Calling SOAP method: ${methodName}`, { fromDate, toDate });

      const response = await axios.post(this.soapUrl, soapEnvelope, {
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'SOAPAction': this.soapAction
        },
        timeout: this.timeout,
        responseType: 'text'
      });

      // Log raw XML response for debugging
      const logsDir = path.join(__dirname, '../../logs');
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      fs.appendFileSync(
        path.join(logsDir, 'soap.log'),
        `===== ${methodName} - ${new Date().toISOString()} =====\n${response.data}\n\n`
      );

      const raw = (response.data || '').trim();
      if (raw.startsWith('{') || raw.startsWith('[')) {
        return JSON.parse(raw);
      } else if (raw.startsWith('<')) {
        return await parseSoapResponse(raw);
      } else {
        throw new Error('Unknown response format: ' + raw.substring(0, 100));
      }
    } catch (error) {
      const errData = error.response?.data;
      const errMsg = typeof errData === 'string'
        ? errData
        : errData ? JSON.stringify(errData) : error.message;
      logger.error(`SOAP call failed for [${methodName}]: ${errMsg}`);
      throw new Error(`[${methodName}] ${errMsg}`);
    }
  }

  extractArraysFromSoapResponse(data) {
    const body = data?.['soap:Envelope']?.['soap:Body']
      ?.GetResponseAsDataSetResponse
      ?.GetResponseAsDataSetResult
      ?.['diffgr:diffgram'];

    if (!body) {
      logger.warn('No diffgram body found in SOAP response');
      return { transactions: [], items: [], payments: [] };
    }

    // Transactions
    const txRaw = body?.eShopaidTransactionSegment?.TransactionSegment;
    const transactions = !txRaw ? []
      : Array.isArray(txRaw) ? txRaw : [txRaw];

    // Items
    const itemRaw = body?.eShopaidItemSegment?.ItemSegment;
    const items = !itemRaw ? []
      : Array.isArray(itemRaw) ? itemRaw : [itemRaw];

    // Payments
    const payRaw = body?.eShopaidPaymentSegment?.PaymentSegment
               ?? body?.NewDataSet?.Table;
    const payments = !payRaw ? []
      : Array.isArray(payRaw) ? payRaw : [payRaw];

    return { transactions, items, payments };
  }

  groupByReceiptNo({ transactions = [], items = [], payments = [] }) {
    const grouped = {};

    for (const tx of transactions) {
      const receipt = tx.RECEIPT_NO;
      if (!receipt) continue;
      grouped[receipt] = {
        receipt_no: receipt,
        transaction: tx,
        items: [],
        payments: []
      };
    }

    for (const item of items) {
      const receipt = item.RECEIPT_NO;
      if (!receipt) continue;
      if (!grouped[receipt]) {
        grouped[receipt] = { receipt_no: receipt, transaction: null, items: [], payments: [] };
      }
      grouped[receipt].items.push(item);
    }

    for (const pay of payments) {
      const receipt = pay.RECEIPT_NO;
      if (!receipt) continue;
      if (!grouped[receipt]) {
        grouped[receipt] = { receipt_no: receipt, transaction: null, items: [], payments: [] };
      }
      grouped[receipt].payments.push(pay);
    }

    return Object.values(grouped);
  }

  async fetchAndGroupAllSegments(fromDate, toDate) {
    logger.info(`Fetching all 3 SOAP segments for ${fromDate} to ${toDate}`);

    const [txData, itemData, payData] = await Promise.all([
      this.callSoapMethod('TransactionSegment', fromDate, toDate),
      this.callSoapMethod('ItemSegment', fromDate, toDate),
      this.callSoapMethod('PaymentSegment', fromDate, toDate)
    ]);

    const { transactions } = this.extractArraysFromSoapResponse(txData);
    const { items } = this.extractArraysFromSoapResponse(itemData);
    const { payments } = this.extractArraysFromSoapResponse(payData);

    logger.info('Segments extracted from SOAP responses', {
      transactionsCount: transactions.length,
      itemsCount: items.length,
      paymentsCount: payments.length
    });

    const grouped = this.groupByReceiptNo({ transactions, items, payments });
    logger.info(`Successfully grouped into ${grouped.length} receipts`);
    return grouped;
  }
}

module.exports = new SoapService();
