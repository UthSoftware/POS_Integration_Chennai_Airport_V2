const fs = require('fs').promises;
const path = require('path');
const logger = require('../config/logger');

class FileReader {
  async readQuery(filePath) {
    try {
      const fullPath = path.resolve(filePath);
      const content = await fs.readFile(fullPath, 'utf-8');
      logger.info('Query file read successfully', { path: filePath });
      return content.trim();
    } catch (error) {
      logger.error('Error reading query file', { path: filePath, error: error.message });
      throw new Error(`Failed to read query file: ${error.message}`);
    }
  }

  async readDbDetails(filePath) {
    try {
      const fullPath = path.resolve(filePath);
      const content = await fs.readFile(fullPath, 'utf-8');
      
      const details = {};
      const lines = content.split('\n');
      
      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine && !trimmedLine.startsWith('#')) {
          const colonIndex = trimmedLine.indexOf(':');
          if (colonIndex > 0) {
            const key = trimmedLine.substring(0, colonIndex).trim().toLowerCase();
            const value = trimmedLine.substring(colonIndex + 1).trim();
            details[key] = value;
          }
        }
      }
      
      logger.info('Database details read successfully', { path: filePath });
      return this.parseDbDetails(details);
    } catch (error) {
      logger.error('Error reading db details file', { path: filePath, error: error.message });
      throw new Error(`Failed to read db details file: ${error.message}`);
    }
  }

  parseDbDetails(details) {
    // Check if SOAP connection type
    if (details.connectiontype === 'soap') {
      const requiredFields = ['soapurl', 'username', 'password'];
      const missing = requiredFields.filter(field => !details[field]);
      
      if (missing.length > 0) {
        throw new Error(`Missing required SOAP fields: ${missing.join(', ')}`);
      }

      logger.info('Parsing SOAP configuration');

      return {
        connectionType: 'soap',
        soapUrl: details.soapurl,
        username: details.username,
        password: details.password,
        ...(details.fromdate && { fromDate: details.fromdate }),
        ...(details.todate && { toDate: details.todate }),
        vendorid: details.vendorid || '',
        vendorName: details.vendorname || 'eShopaid',
        timeout: parseInt(details.timeout) || 60000
      };
    }

    // Check if Tally REST API connection type
    if (details.connectiontype === 'tally') {
      const requiredFields = ['tallyapiurl'];
      const missing = requiredFields.filter(field => !details[field]);
      
      if (missing.length > 0) {
        throw new Error(`Missing required Tally fields: ${missing.join(', ')}`);
      }

      logger.info('Parsing Tally REST API configuration');

      return {
        connectionType: 'tally',
        tallyApiUrl: details.tallyapiurl,
        vendorid: details.vendorid || '',
        vendorName: details.vendorname || 'TallyStore',
        timeout: parseInt(details.timeout) || 60000
      };
    }

    // Database connection (existing logic)
    const requiredFields = ['server', 'username', 'password', 'port', 'dbtype'];
    const missing = requiredFields.filter(field => !details[field]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required database fields: ${missing.join(', ')}`);
    }

    logger.info('Parsing database configuration', { dbType: details.dbtype });

    return {
      connectionType: 'database',
      server: details.server,
      username: details.username,
      password: details.password,
      port: details.port || '',
      vendorid: details.vendorid || '',
      database: details.database || details.dbname || '',
      dbType: details.dbtype.toLowerCase(),
      encrypt: details.encrypt === 'true',
      trustServerCertificate: details.trustservercertificate !== 'false'
    };
  }
}

module.exports = new FileReader();