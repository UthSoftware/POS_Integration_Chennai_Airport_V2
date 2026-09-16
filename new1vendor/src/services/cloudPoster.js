const axios = require('axios');
const logger = require('../config/logger');

class CloudPoster {
  constructor() {
    this.apiUrl = process.env.CLOUD_API_URL;
    this.apiKey = process.env.CLOUD_API_KEY;
    this.maxRetries = parseInt(process.env.MAX_RETRIES) || 3;
    this.retryDelay = parseInt(process.env.RETRY_DELAY_MS) || 2000;
  }

  async postData(data, metadata = {}, retryCount = 0) {
    const recordCount = Array.isArray(data) ? data.length : 1;

    try {
      logger.info('Posting data to Cloud API', {
        endpoint: this.apiUrl,
        recordCount,
        attempt: retryCount + 1
      });

      const payload = {
        data: data,
        metadata: {
          ...metadata,
          vendorid: process.env.VENDOR_ID || metadata.vendorid || 'VVC00047',
          vendorName: process.env.VENDOR_NAME || metadata.vendorName || 'eShopaidStore',
          timestamp: new Date().toISOString(),
          source: 'vendor-soap-fetcher'
        }
      };

      const requestId = this.generateRequestId();

      logger.info('Payload sample to Cloud API', {
        requestId,
        sampleReceipt: Array.isArray(data) && data[0] ? data[0].receipt_no : 'N/A',
        totalReceipts: recordCount
      });

      const response = await axios.post(
        this.apiUrl,
        payload,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
            'X-Request-ID': requestId
          },
          timeout: 60000
        }
      );

      logger.info('Data posted successfully to Cloud API', {
        status: response.status,
        statusText: response.statusText,
        recordCount
      });

      return {
        success: true,
        status: response.status,
        data: response.data
      };
    } catch (error) {
      logger.error('Cloud API Post Error', {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        responseData: error.response?.data,
        attempt: retryCount + 1
      });

      if (retryCount < this.maxRetries && this.isRetryableError(error)) {
        const delay = this.calculateBackoff(retryCount);
        logger.info(`Retrying cloud post in ${delay}ms (Attempt ${retryCount + 2} of ${this.maxRetries + 1})...`);
        await this.sleep(delay);
        return this.postData(data, metadata, retryCount + 1);
      }

      throw error;
    }
  }

  isRetryableError(error) {
    if (!error.response) return true; // Network errors / timeouts
    const status = error.response.status;
    return status >= 500 || status === 429 || status === 408;
  }

  calculateBackoff(retryCount) {
    const MAX_DELAY = 10 * 60 * 1000; // 10 minutes max
    return Math.min(this.retryDelay * Math.pow(2, retryCount), MAX_DELAY);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  generateRequestId() {
    return `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

module.exports = new CloudPoster();
