const oracledb = require('oracledb');
const sql = require('mssql');
const mysql = require('mysql2/promise');
const Firebird = require('node-firebird');
const { Pool } = require('pg');
const logger = require('../config/logger');

class DatabaseConnector {
  constructor() {
    this.connection = null;
    this.dbType = null;
  }

  async connect(config) {
    try {
      logger.info('Connecting to database', { type: config.dbType, server123: config.server, vendor: config.vendorid });
      
      this.dbType = config.dbType;
      
      switch (config.dbType) {
        case 'oracle':
          this.connection = await this.connectOracle(config);
          break;
        case 'mssql':
        case 'sqlserver':
          this.connection = await this.connectMSSQL(config);
          break;
        case 'mysql':
          this.connection = await this.connectMySQL(config);
          break;
        case 'firebird':
          this.connection = await this.connectFirebird(config);
          break;
        case 'postgresql':
        case 'postgres':
        case 'pgsql':
          this.connection = await this.connectPostgreSQL(config);
          break;
        default:
          throw new Error(`Unsupported database type: ${config.dbType}`);
      }
      
      logger.info('Database connected successfully', { type: config.dbType });
      return this.connection;
    } catch (error) {
      logger.error('Database connection failed', { 
        type: config.dbType, 
        error: error.message 
      });
      throw error;
    }
  }

  async connectOracle(config) {
    return await oracledb.getConnection({
      user: config.username,
      password: config.password,
      connectString: `${config.server}:${config.port}/${config.database || 'ORCL'}`
    });
  }

  async connectMSSQL(config) {
    return await sql.connect({
      user: config.username,
      password: config.password,
      server: config.server,
      port: parseInt(config.port),
      database: config.database,
      options: {
        encrypt: config.encrypt || false,
        trustServerCertificate: config.trustServerCertificate || true
      }
    });
  }

  async connectMySQL(config) {
    return await mysql.createConnection({
      host: config.server,
      port: parseInt(config.port),
      user: config.username,
      password: config.password,
      database: config.database
    });
  }

  async connectFirebird(config) {
    return new Promise((resolve, reject) => {
      const options = {
        host: config.server,
        port: parseInt(config.port),
        database: config.database,
        user: config.username,
        password: config.password
      };

      Firebird.attach(options, (err, db) => {
        if (err) reject(err);
        else resolve(db);
      });
    });
  }

  async connectPostgreSQL(config) {
    const pool = new Pool({
      host: config.server,
      port: parseInt(config.port),
      user: config.username,
      password: config.password,
      database: config.database,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000
    });
    
    await pool.query('SELECT NOW()');
    return pool;
  }

  async executeQuery(query) {
    try {
      logger.info('Executing query', { type: this.dbType });
      
      switch (this.dbType) {
        case 'oracle':
          return await this.executeOracleQuery(query);
        case 'mssql':
        case 'sqlserver':
          return await this.executeMSSQLQuery(query);
        case 'mysql':
          return await this.executeMySQLQuery(query);
        case 'firebird':
          return await this.executeFirebirdQuery(query);
        case 'postgresql':
        case 'postgres':
        case 'pgsql':
          return await this.executePostgreSQLQuery(query);
        default:
          throw new Error(`Unsupported database type: ${this.dbType}`);
      }
    } catch (error) {
      logger.error('Query execution failed', { 
        type: this.dbType, 
        error: error.message 
      });
      throw error;
    }
  }

  async executeOracleQuery(query) {
    const result = await this.connection.execute(query, [], { 
      outFormat: oracledb.OUT_FORMAT_OBJECT 
    });
    return result.rows;
  }

  async executeMSSQLQuery(query) {
    const result = await this.connection.request().query(query);
    return result.recordset;
  }

  async executeMySQLQuery(query) {
    const [rows] = await this.connection.execute(query);
    return rows;
  }

  async executeFirebirdQuery(query) {
    return new Promise((resolve, reject) => {
      this.connection.query(query, [], (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
  }

  async executePostgreSQLQuery(query) {
    const result = await this.connection.query(query);
    return result.rows;
  }

  async close() {
    if (!this.connection) return;
    
    try {
      logger.info('Closing database connection', { type: this.dbType });
      
      switch (this.dbType) {
        case 'oracle':
          await this.connection.close();
          break;
        case 'mssql':
        case 'sqlserver':
          await this.connection.close();
          break;
        case 'mysql':
          await this.connection.end();
          break;
        case 'firebird':
          this.connection.detach();
          break;
        case 'postgresql':
        case 'postgres':
        case 'pgsql':
          await this.connection.end();
          break;
      }
      
      this.connection = null;
      logger.info('Database connection closed', { type: this.dbType });
    } catch (error) {
      logger.error('Error closing connection', { 
        type: this.dbType, 
        error: error.message 
      });
    }
  }
}

module.exports = DatabaseConnector;