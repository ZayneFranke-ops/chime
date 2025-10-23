const mysql = require('mysql2/promise');
require('dotenv').config();

let connection;

const dbConfig = {
  host: process.env.DB_HOST || 'sql311.infinityfree.com',
  user: process.env.DB_USER || 'if0_40232921',
  password: process.env.DB_PASSWORD || 'S4LYpeaeRQFmOh',
  database: process.env.DB_NAME || 'if0_40232921_chime_api',
  port: process.env.DB_PORT || 3306,
  charset: 'utf8mb4',
  timezone: '+00:00',
  acquireTimeout: 60000,
  timeout: 60000,
  reconnect: true,
  ssl: false
};

async function createConnection() {
  try {
    connection = await mysql.createConnection(dbConfig);
    console.log('Connected to MySQL database');
    return connection;
  } catch (error) {
    console.error('Database connection failed:', error);
    throw error;
  }
}

async function initializeDatabase() {
  try {
    await createConnection();
    
    // Test the connection
    await connection.execute('SELECT 1');
    console.log('Database connection verified');
    
    return connection;
  } catch (error) {
    console.error('Database initialization failed:', error);
    throw error;
  }
}

function getConnection() {
  if (!connection) {
    throw new Error('Database not initialized');
  }
  return connection;
}

async function executeQuery(query, params = []) {
  try {
    const conn = getConnection();
    const [rows] = await conn.execute(query, params);
    return rows;
  } catch (error) {
    console.error('Query execution failed:', error);
    throw error;
  }
}

async function executeTransaction(queries) {
  const conn = getConnection();
  await conn.beginTransaction();
  
  try {
    const results = [];
    for (const { query, params } of queries) {
      const [rows] = await conn.execute(query, params);
      results.push(rows);
    }
    await conn.commit();
    return results;
  } catch (error) {
    await conn.rollback();
    throw error;
  }
}

module.exports = {
  initializeDatabase,
  getConnection,
  executeQuery,
  executeTransaction
};
