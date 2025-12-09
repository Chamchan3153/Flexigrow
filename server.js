console.log('✅ Server starting...');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  console.log('✅ GET / request received');
  res.json({ status: 'OK', message: 'Backend is working' });
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

// Keep process alive
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});
