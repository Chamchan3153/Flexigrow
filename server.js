const express = require('express');
const cors = require('cors');
const sql = require('mssql');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// ✅ NODE.JS 18 - Better SQL Server Compatibility
// Node.js 18 has better TLS support for older SQL Server configurations
// This backend is specifically configured for Node.js 18 to avoid TLS issues

// SQL Server Configuration
const DB_CONFIG = {
  server: process.env.DB_SERVER || '52.156.170.147',
  port: parseInt(process.env.DB_PORT || '2433'),
  database: process.env.DB_NAME || 'Flexifundit.Prod',
  user: process.env.DB_USER || 'river_funder',
  password: process.env.DB_PASSWORD || '1dnhXwtw!',
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
    connectTimeout: 30000,
    requestTimeout: 30000,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  }
};

// Connection pool cache
let pool = null;
let lastError = null;

async function getConnection() {
  if (pool && pool.connected) {
    return pool;
  }

  console.log('🔌 Attempting SQL Server connection (Node.js 18)...');
  console.log('✅ Node.js 18 provides better compatibility with SQL Server TLS configurations.');
  
  // Try multiple connection strategies
  const strategies = [
    {
      name: 'No Encryption (encrypt: false)',
      config: { ...DB_CONFIG, options: { ...DB_CONFIG.options, encrypt: false } }
    },
    {
      name: 'With Encryption + Trust Certificate',
      config: { ...DB_CONFIG, options: { ...DB_CONFIG.options, encrypt: true } }
    },
    {
      name: 'Connection String Format',
      config: `Server=${DB_CONFIG.server},${DB_CONFIG.port};Database=${DB_CONFIG.database};User Id=${DB_CONFIG.user};Password=${DB_CONFIG.password};Encrypt=false;TrustServerCertificate=true;Connection Timeout=30;`
    }
  ];

  for (let i = 0; i < strategies.length; i++) {
    const strategy = strategies[i];
    try {
      console.log(`🔄 Strategy ${i + 1}: ${strategy.name}`);
      
      if (typeof strategy.config === 'string') {
        pool = await sql.connect(strategy.config);
      } else {
        pool = await sql.connect(strategy.config);
      }
      
      console.log(`✅ Connected using Strategy ${i + 1}: ${strategy.name}`);
      return pool;
    } catch (error) {
      console.warn(`❌ Strategy ${i + 1} failed: ${error.message}`);
      lastError = error;
      pool = null;
    }
  }

  // All strategies failed
  console.error('❌ All connection strategies failed');
  console.error('📋 Last error details:', {
    message: lastError?.message,
    code: lastError?.code,
    errno: lastError?.errno
  });
  
  const errorMessage = lastError?.message || 'Unknown error';
  const isTLSError = errorMessage.includes('unsupported protocol') || 
                    errorMessage.includes('TLS') || 
                    errorMessage.includes('SSL') ||
                    errorMessage.includes('ssl_choose_client_version');
  
  if (isTLSError) {
    throw new Error(`TLS/SSL Error: Connection failed. Node.js 18 should have better compatibility, but SQL Server may need configuration updates. Original error: ${errorMessage}`);
  }
  
  throw new Error(`Failed to connect to SQL Server: ${errorMessage}`);
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    environment: process.env.NODE_ENV || 'development'
  });
});

// Test endpoint
app.get('/test', async (req, res) => {
  try {
    const connection = await getConnection();
    res.json({
      success: true,
      message: 'Database connection successful',
      server: DB_CONFIG.server,
      database: DB_CONFIG.database,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Main data endpoint
app.get('/api/data', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'Missing startDate or endDate parameters. Use: ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD'
      });
    }

    console.log(`📊 Fetching data from ${startDate} to ${endDate}`);

    const connection = await getConnection();

    // Step 1: Find the Business Written table
    console.log('🔍 Searching for Business Written table...');
    
    const tableSearchQuery = `
      SELECT TABLE_SCHEMA, TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE = 'BASE TABLE'
      AND (
        TABLE_NAME LIKE '%Business%Written%' 
        OR TABLE_NAME LIKE '%Business_Written%'
        OR TABLE_NAME LIKE '%BusinessWritten%'
        OR TABLE_NAME LIKE '%Loan%'
        OR TABLE_NAME LIKE '%Premium%'
        OR TABLE_NAME LIKE '%Policy%'
        OR TABLE_NAME LIKE '%Commission%'
        OR TABLE_NAME LIKE '%Transaction%'
      )
      ORDER BY 
        CASE 
          WHEN TABLE_NAME LIKE '%Business%Written%' THEN 1
          WHEN TABLE_NAME LIKE '%Business_Written%' THEN 2
          WHEN TABLE_NAME LIKE '%BusinessWritten%' THEN 3
          WHEN TABLE_NAME LIKE '%Loan%' THEN 4
          WHEN TABLE_NAME LIKE '%Policy%' THEN 5
          ELSE 6
        END,
        TABLE_NAME
    `;

    const tablesResult = await connection.request().query(tableSearchQuery);
    console.log(`📋 Found ${tablesResult.recordset.length} potential tables`);

    if (tablesResult.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No Business Written table found in database'
      });
    }

    const tableInfo = tablesResult.recordset[0];
    const schema = tableInfo.TABLE_SCHEMA || 'dbo';
    const tableName = tableInfo.TABLE_NAME;
    console.log(`✅ Using table: ${schema}.${tableName}`);

    // Step 2: Get column information
    console.log('📋 Getting column information...');
    const columnsResult = await connection.request()
      .input('schema', sql.VarChar, schema)
      .input('table', sql.VarChar, tableName)
      .query(`
        SELECT 
          COLUMN_NAME,
          DATA_TYPE,
          IS_NULLABLE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table
        ORDER BY ORDINAL_POSITION
      `);

    const columns = columnsResult.recordset.map(r => r.COLUMN_NAME);
    console.log(`📊 Table has ${columns.length} columns:`, columns.slice(0, 10).join(', '), '...');

    // Step 3: Find date column
    const dateColumns = columns.filter(col => 
      col.toLowerCase().includes('date') || 
      col.toLowerCase().includes('written') ||
      col.toLowerCase().includes('created') ||
      col.toLowerCase().includes('time')
    );

    let dateColumn = dateColumns[0] || columns.find(col => 
      columnsResult.recordset.find(r => r.COLUMN_NAME === col && r.DATA_TYPE.includes('date'))
    );

    if (!dateColumn && columns.length > 0) {
      const datetimeCol = columnsResult.recordset.find(r => 
        r.DATA_TYPE.includes('date') || r.DATA_TYPE.includes('time')
      );
      dateColumn = datetimeCol ? datetimeCol.COLUMN_NAME : null;
    }

    console.log(`📅 Date column: ${dateColumn || 'NOT FOUND - will query all rows'}`);

    // Step 4: Build optimized query
    const keyColumns = columns.filter(col => {
      const lower = col.toLowerCase();
      return lower.includes('date') || 
             lower.includes('loan') || 
             lower.includes('client') || 
             lower.includes('premium') || 
             lower.includes('amount') ||
             lower.includes('fee') ||
             lower.includes('commission') ||
             lower.includes('policy') ||
             lower.includes('user') ||
             lower.includes('source');
    });

    const selectColumns = keyColumns.length > 0 
      ? [...keyColumns, ...columns.filter(c => !keyColumns.includes(c))].slice(0, 50)
      : columns.slice(0, 50);

    const selectList = selectColumns.map(col => `[${col}]`).join(', ');
    
    let query;
    if (dateColumn) {
      query = `SELECT TOP 1000 ${selectList} 
               FROM [${schema}].[${tableName}] 
               WHERE [${dateColumn}] BETWEEN @startDate AND @endDate 
               ORDER BY [${dateColumn}] DESC`;
      console.log(`📅 Filtering by ${dateColumn} from ${startDate} to ${endDate}`);
    } else {
      query = `SELECT TOP 1000 ${selectList} 
               FROM [${schema}].[${tableName}] 
               ORDER BY (SELECT NULL)`;
      console.log('⚠️  No date column found - returning all rows (limited to 1000)');
    }

    console.log(`🔍 Executing query...`);
    const request = connection.request();
    
    if (dateColumn) {
      request.input('startDate', sql.Date, startDate);
      request.input('endDate', sql.Date, endDate);
    }

    const result = await request.query(query);
    console.log(`✅ Retrieved ${result.recordset.length} rows`);

    // Step 5: Format response
    const data = result.recordset.map(row => {
      const formatted = {};
      for (const key in row) {
        const value = row[key];
        if (value instanceof Date) {
          formatted[key] = value.toISOString().split('T')[0];
        } else {
          formatted[key] = value;
        }
      }
      return formatted;
    });

    return res.status(200).json({
      success: true,
      count: data.length,
      table: `${schema}.${tableName}`,
      dateColumn: dateColumn || null,
      columns: columns,
      data: data,
      query: {
        startDate: startDate || null,
        endDate: endDate || null
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);

    let userMessage = error.message;
    let errorCode = error.code || 'UNKNOWN';

    if (error.code === 'ELOGIN') {
      userMessage = 'Login failed. Check username/password.';
      errorCode = 'AUTHENTICATION_ERROR';
    } else if (error.code === 'ETIMEOUT' || error.code === 'ETIMEDOUT') {
      userMessage = 'Connection timeout. Server may be down or firewall blocking.';
      errorCode = 'CONNECTION_TIMEOUT';
    } else if (error.message && (error.message.includes('TLS') || error.message.includes('SSL') || error.message.includes('unsupported protocol') || error.message.includes('ssl_choose_client_version'))) {
      userMessage = error.message.includes('SOLUTION REQUIRED') 
        ? error.message 
        : 'TLS/SSL Error: Connection failed. Node.js 18 should have better compatibility, but SQL Server may need configuration updates.';
      errorCode = 'TLS_ERROR';
    } else if (error.message && error.message.includes('Invalid object name')) {
      userMessage = 'Table not found. Database structure may have changed.';
      errorCode = 'TABLE_NOT_FOUND';
    }

    return res.status(500).json({
      success: false,
      error: userMessage,
      errorCode: errorCode,
      detail: process.env.NODE_ENV === 'development' ? error.message : undefined,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Start server - FIXED FOR RAILWAY
app.listen(PORT, () => {
  console.log(`🚀 Custom Backend Server running on port ${PORT}`);
  console.log(`📊 Node.js Version: ${process.version}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  console.log(`📈 Data endpoint: http://localhost:${PORT}/api/data`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing database connections...');
  if (pool) {
    await pool.close();
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, closing database connections...');
  if (pool) {
    await pool.close();
  }
  process.exit(0);
});
