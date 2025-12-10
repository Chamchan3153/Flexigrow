const express = require('express');
const cors = require('cors');
const sql = require('mssql');
require('dotenv').config();

const app = express();
// Railway sets PORT automatically - use it or default to 3000
const PORT = process.env.PORT || 3000;

// Log startup info immediately
console.log('🚀 Starting FlexiGrow Backend...');
console.log(`📊 Node.js Version: ${process.version}`);
console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`🔌 Port: ${PORT}`);

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

// List all tables endpoint - Diagnostic tool
app.get('/api/tables', async (req, res) => {
  try {
    console.log('🔍 Listing all tables in database...');
    const connection = await getConnection();

    const query = `
      SELECT 
        TABLE_SCHEMA,
        TABLE_NAME,
        TABLE_TYPE
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_SCHEMA, TABLE_NAME
    `;

    const result = await connection.request().query(query);
    console.log(`📋 Found ${result.recordset.length} tables`);

    const tables = result.recordset.map(row => ({
      schema: row.TABLE_SCHEMA,
      name: row.TABLE_NAME,
      fullName: `${row.TABLE_SCHEMA}.${row.TABLE_NAME}`
    }));

    // Also search for tables with keywords
    const keywords = ['Business', 'Written', 'Loan', 'Premium', 'Policy', 'Commission', 'Transaction', 'Client', 'Customer'];
    const matchingTables = tables.filter(table => 
      keywords.some(keyword => table.name.toLowerCase().includes(keyword.toLowerCase()))
    );

    return res.status(200).json({
      success: true,
      totalTables: tables.length,
      allTables: tables,
      matchingTables: matchingTables,
      keywords: keywords,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error listing tables:', error.message);
    return res.status(500).json({
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

    // Step 1: Find the Business Written table by looking for key columns
    console.log('🔍 Searching for Business Written table with columns: LOAN ID, CLIENT ID, PREMIUM, COMMISSION...');
    
    // First, find tables that have the key columns we need
    const tableSearchQuery = `
      SELECT DISTINCT 
        t.TABLE_SCHEMA,
        t.TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES t
      INNER JOIN INFORMATION_SCHEMA.COLUMNS c ON t.TABLE_SCHEMA = c.TABLE_SCHEMA 
        AND t.TABLE_NAME = c.TABLE_NAME
      WHERE t.TABLE_TYPE = 'BASE TABLE'
      AND (
        -- Look for tables with key columns
        (c.COLUMN_NAME LIKE '%Loan%ID%' OR c.COLUMN_NAME LIKE '%LoanId%' OR c.COLUMN_NAME LIKE '%Loan_ID%')
        AND (c.COLUMN_NAME LIKE '%Client%ID%' OR c.COLUMN_NAME LIKE '%ClientId%' OR c.COLUMN_NAME LIKE '%Client_ID%')
        AND (c.COLUMN_NAME LIKE '%Premium%' OR c.COLUMN_NAME LIKE '%Commission%')
      )
      OR (
        -- Also check table names
        t.TABLE_NAME LIKE '%Business%Written%' 
        OR t.TABLE_NAME LIKE '%Business_Written%'
        OR t.TABLE_NAME LIKE '%BusinessWritten%'
        OR t.TABLE_NAME LIKE '%Loan%'
        OR t.TABLE_NAME LIKE '%Policy%'
        OR t.TABLE_NAME LIKE '%Transaction%'
      )
      ORDER BY 
        CASE 
          WHEN t.TABLE_NAME LIKE '%Business%Written%' THEN 1
          WHEN t.TABLE_NAME LIKE '%Business_Written%' THEN 2
          WHEN t.TABLE_NAME LIKE '%BusinessWritten%' THEN 3
          ELSE 4
        END,
        t.TABLE_NAME
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

    // Step 4: Build query with columns matching Business Written report
    // Report columns: DATE, LOAN ID, CLIENT ID, CLIENT NAME, USER, SOURCE,
    // PREMIUM, AMENDMENT, ADMIN FEE, TOTAL INTEREST (%), TOTAL INTEREST ($),
    // COMMISSION (%), COMMISSION ($), FINANCED ($), INCOME ($)
    
    const reportColumnPatterns = [
      'date', 'loan', 'client', 'user', 'source', 'premium', 'amendment',
      'admin', 'fee', 'interest', 'commission', 'financed', 'income'
    ];

    const keyColumns = columns.filter(col => {
      const lower = col.toLowerCase();
      return reportColumnPatterns.some(pattern => lower.includes(pattern));
    });

    // Prioritize date column, then key columns, then others
    const selectColumns = [
      dateColumn,
      ...keyColumns.filter(c => c !== dateColumn),
      ...columns.filter(c => c !== dateColumn && !keyColumns.includes(c))
    ].filter(Boolean).slice(0, 50);

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

// Start server
// Railway requires listening on 0.0.0.0 and using PORT env variable
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Custom Backend Server running on port ${PORT}`);
  console.log(`📊 Node.js Version: ${process.version}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Health check: http://0.0.0.0:${PORT}/health`);
  console.log(`📈 Data endpoint: http://0.0.0.0:${PORT}/api/data`);
  console.log(`🎉 Server is ready to accept connections!`);
});

// Handle server errors
server.on('error', (error) => {
  console.error('❌ Server Error:', error);
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use!`);
  }
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
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
