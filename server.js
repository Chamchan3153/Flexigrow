console.log('🔧 Starting FlexiGrow backend...');

const express = require('express');
const app = express();
app.use(express.json());

// ONLY require SQL if credentials exist
let sql = null;
let sqlConfig = null;

if (process.env.DB_USER && process.env.DB_SERVER) {
  try {
    sql = require('mssql');
    sqlConfig = {
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      server: process.env.DB_SERVER,
      database: process.env.DB_NAME,
      options: {
        encrypt: true,
        trustServerCertificate: false
      }
    };
    console.log('✅ SQL module loaded (will connect on demand)');
  } catch (err) {
    console.log('⚠️ SQL module failed to load:', err.message);
  }
} else {
  console.log('⚠️ SQL credentials missing, running in API-only mode');
}

// Health check route - NEVER FAILS
app.get('/', (req, res) => {
  res.json({ 
    status: 'ALIVE', 
    sql_ready: !!sql,
    timestamp: new Date().toISOString()
  });
});

// SQL test route - only if module loaded
app.get('/test-db', async (req, res) => {
  if (!sql) {
    return res.json({ error: 'SQL module not loaded. Check Railway Variables.' });
  }
  
  try {
    console.log('Attempting SQL connection...');
    const pool = await sql.connect(sqlConfig);
    const result = await pool.request().query('SELECT TOP 1 * FROM your_table');
    await pool.close();
    
    res.json({ 
      success: true, 
      data: result.recordset 
    });
  } catch (err) {
    console.error('SQL Connection Error:', err.message);
    res.json({ 
      error: 'SQL connection failed',
      details: err.message,
      config: {
        server: sqlConfig.server,
        user: sqlConfig.user,
        database: sqlConfig.database
      }
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🔑 DB_USER: ${process.env.DB_USER || 'NOT SET'}`);
  console.log(`🔑 DB_SERVER: ${process.env.DB_SERVER || 'NOT SET'}`);
});
