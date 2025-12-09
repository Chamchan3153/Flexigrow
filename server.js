const express = require('express');
const sql = require('mssql');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// Get SQL credentials from Railway environment variables
const sqlConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  options: {
    encrypt: true,
    trustServerCertificate: false
  }
};

// Test route - DELETE THIS LATER
app.get('/', async (req, res) => {
  try {
    let pool = await sql.connect(sqlConfig);
    const result = await pool.request().query('SELECT TOP 1 * FROM your_table');
    res.json({ 
      message: '✅ Backend is LIVE! Connected to SQL Server',
      data: result.recordset 
    });
  } catch (err) {
    console.error('SQL Error:', err);
    res.status(500).json({ 
      error: 'Database connection failed',
      details: err.message 
    });
  }
});

// Add your FlexiGrow routes here later
// app.post('/api/login', (req, res) => {...})
// app.get('/api/data', (req, res) => {...})

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 FlexiGrow backend running on port ${PORT}`);
});
