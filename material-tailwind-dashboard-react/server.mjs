import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Serve static files from dist
app.use(express.static(path.join(__dirname, 'dist')));

// Basic test endpoint for GET requests
app.get('/api/hello', (req, res) => {
  res.json({ success: true, data: 'Hello from Express!', timestamp: new Date().toISOString() });
});

// Proxy endpoint for GET requests to any URL
app.get('/api/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).json({ success: false, error: 'Missing url parameter' });
  }
  try {
    const response = await fetch(targetUrl);
    const contentType = response.headers.get('content-type') || '';
    let data;
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// // Dedicated endpoint to fetch data from http://httpbin.org/get
// app.get('/api/httpbin', async (req, res) => {
//   try {
//     const response = await fetch('http://httpbin.org/get');
//     const data = await response.json();
//     res.json({ success: true, data });
//   } catch (error) {
//     res.status(500).json({ success: false, error: error.message });
//   }
// });

// Fallback to index.html for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const PORT = process.env.PORT || 80;
app.listen(PORT, () => console.log(`Express server running on port ${PORT}`));
