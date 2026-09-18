const axios = require('axios');
const logger = require('../config/logger');

class CloudPoster {
  constructor() {
    this.apiUrl = process.env.CLOUD_API_URL;
    console.log('API URL:', this.apiUrl);
    this.apiKey = process.env.CLOUD_API_KEY;
    this.maxRetries = parseInt(process.env.MAX_RETRIES) || 3;
    this.retryDelay = parseInt(process.env.RETRY_DELAY_MS) || 2000;
  }

  async postData(data, metadata = {}, retryCount = 0) {
    try {
      logger.info('Posting data to cloud API', { 
        recordCount: Array.isArray(data) ? data.length : 1,
        attempt: retryCount + 1 
      });
      
   logger.info({
  message: 'Payload',
  data,
  metadata: {
    ...metadata,
    timestamp: new Date().toISOString(),
    source: 'vendor-db-fetcher'
  }
});



      const response = await axios.post(
        this.apiUrl,
        {
          data: data,
          metadata: {
            ...metadata,
            timestamp: new Date().toISOString(),
            source: 'vendor-db-fetcher'
          }
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
            'X-Request-ID': this.generateRequestId()
          },
          timeout: 60000
        }
      );

      logger.info('Data posted successfully', {
        status: response.status,
        recordCount: Array.isArray(data) ? data.length : 1
      });

      return {
        success: true,
        status: response.status,
        data: response.data
      };
    } catch (error) {
      logger.error('Axios Error Full Dump', {
    message: error.message,
    method: error.config?.method,
    url: error.config?.url,
    headers: error.config?.headers,
    requestData: error.config?.data,
    status: error.response?.status,
    responseData: error.response?.data,
        attempt: retryCount + 1
      });

      if (retryCount < this.maxRetries && this.isRetryableError(error)) {
        const delay = this.calculateBackoff(retryCount);
        logger.info(`Retrying in ${delay}ms...`);
        await this.sleep(delay);
        return this.postData(data, metadata, retryCount + 1);
      }

      throw error;
    }
  }

  isRetryableError(error) {
    if (!error.response) return true;
    const status = error.response.status;
    return status >= 500 || status === 429 || status === 408;
  }
  
calculateBackoff(retryCount) {
  const MAX_DELAY = 10 * 60 * 1000; // 10 minutes
  return Math.min(this.retryDelay * Math.pow(2, retryCount), MAX_DELAY);
}


  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  generateRequestId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

module.exports = new CloudPoster();