/**
 * Sanitizes and formats grouped receipts by stripping XML diffgram attributes ($)
 * and normalizing fields into standard POS schemas (G100, G111, G115).
 */
function sanitizeReceipts(groupedReceipts) {
  if (!Array.isArray(groupedReceipts)) {
    return [];
  }

  return groupedReceipts.map(entry => {
    const receiptNo = entry.receipt_no || entry.transaction?.RECEIPT_NO || '';
    const tx = entry.transaction || {};
    const txTimestamp = tx.TIMESTAMP || new Date().toISOString();

    const sanitizedTx = {
      RECORD_TYPE: tx.RECORD_TYPE || 'G100',
      POS_TILL: tx.POS_TILL || '',
      SHIFT_NO: tx.SHIFT_NO || '',
      RECEIPT_NO: receiptNo,
      TIMESTAMP: txTimestamp,
      INV_AMT: String(tx.INV_AMT ?? '0'),
      TAX_AMT: String(tx.TAX_AMT ?? '0'),
      DIS_AMT: String(tx.DIS_AMT ?? '0'),
      NET_AMT: String(tx.NET_AMT ?? '0'),
      RET_AMT: String(tx.RET_AMT ?? '0'),
      CUST_NAME: tx.CUST_NAME || '',
      TRANSACTION_STATUS: tx.TRANSACTION_STATUS || 'SALES'
    };

    const items = Array.isArray(entry.items) ? entry.items : entry.items ? [entry.items] : [];
    const sanitizedItems = items.map(item => ({
      RECORD_TYPE: item.RECORD_TYPE || 'G111',
      RECEIPT_NO: receiptNo,
      TIMESTAMP: item.TIMESTAMP || txTimestamp,
      ITEM_CODE: String(item.ITEM_CODE || ''),
      ITEM_NAME: item.ITEM_NAME || '',
      ITEM_QTY: String(item.ITEM_QTY ?? '1'),
      ITEM_PRICE: String(item.ITEM_PRICE ?? '0'),
      ITEM_CATG: item.ITEM_CATG || '',
      TAX_NAME: item.TAX_NAME || '',
      TAX_AMT: String(item.TAX_AMT ?? '0'),
      DISC_AMT: String(item.DISC_AMT ?? '0'),
      TAX_TYPE: item.TAX_TYPE || 'E',
      NET_AMT: String(item.NET_AMT ?? '0'),
      TRANSACTION_STATUS: item.TRANSACTION_STATUS || 'SALES'
    }));

    const payments = Array.isArray(entry.payments) ? entry.payments : entry.payments ? [entry.payments] : [];
    const sanitizedPayments = payments.map(pay => ({
      RECORD_TYPE: pay.RECORD_TYPE || 'G115',
      RECEIPT_NO: receiptNo,
      TIMESTAMP: pay.TIMESTAMP || txTimestamp,
      PAYMENT_NAME: pay.PAYMENT_NAME || 'Cash',
      CURR_CODE: String(pay.CURR_CODE ?? '1'),
      EXCHANGE_RATE: String(pay.EXCHANGE_RATE ?? '1'),
      AMOUNT: String(pay.AMOUNT ?? '0'),
      TRANSACTION_STATUS: pay.TRANSACTION_STATUS || 'SALES'
    }));

    return {
      receipt_no: receiptNo,
      transaction: sanitizedTx,
      items: sanitizedItems,
      payments: sanitizedPayments
    };
  });
}

module.exports = {
  sanitizeReceipts
};
