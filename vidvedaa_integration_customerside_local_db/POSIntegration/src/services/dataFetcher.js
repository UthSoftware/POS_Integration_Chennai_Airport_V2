const DatabaseConnector = require('../database/connector');
const fileReader = require('../utils/fileReader');

const cloudPoster = require('./cloudPoster');
const logger = require('../config/logger');

class DataFetcher {
  async fetchAndPost() {
    const connector = new DatabaseConnector();
    
    try {
      logger.info('Starting data fetch cycle');
      
      const dbDetailsFile = process.env.DB_DETAILS_FILE || './config/db_details.txt';
      const queryFile = process.env.QUERY_FILE || './config/query.txt';
      
      const dbConfig = await fileReader.readDbDetails(dbDetailsFile);
      const query = await fileReader.readQuery(queryFile);
      
      await connector.connect(dbConfig);
      
      const results = await connector.executeQuery(query);
      
      if (!results || results.length === 0) {
        logger.warn('No data fetched from database');
        return { success: true, recordCount: 0 };
      }
      
      logger.info('Data fetched successfully', { recordCount: results.length });
      
      const metadata = {
        dbType: dbConfig.dbType,
        server: dbConfig.server,
        database: dbConfig.database,
        vendorid: dbConfig.vendorid,
        fetchedAt: new Date().toISOString()
      };
      
      const postResult = await cloudPoster.postData(results, metadata);
      
      logger.info('Fetch and post cycle completed', {
        recordCount: results.length,
        postStatus: postResult.status
      });
      
      return {
        success: true,
        recordCount: results.length,
        postResult: postResult
      };
      
    } catch (error) {
      logger.error('Fetch and post cycle failed', { error: error.message, stack: error.stack });
      throw error;
    } finally {
      await connector.close();
    }
  }
}

module.exports = new DataFetcher();