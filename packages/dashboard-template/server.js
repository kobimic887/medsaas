import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import signupHandler from './src/api/signup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Middleware to parse JSON bodies
app.use(express.json());

// Serve static files from dist
app.use(express.static(path.join(__dirname, 'dist')));

// Proxy /api requests to your backend logic (example: Stripe)
// If your backend logic is in Express, mount the router here
// If not, use a proxy to the backend server
// Example: app.use('/api', stripeServer);


// Basic test endpoint for GET requests
app.get('/api/hello', (req, res) => {
  res.json({ success: true, data: 'Hello from Express!', timestamp: new Date().toISOString() });
});

// Example endpoint to proxy a GET request to another site
app.get('/api/proxy', async (req, res) => {
  try {
    const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
    const response = await fetch('https://jsonplaceholder.typicode.com/todos/1');
    const data = await response.json();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Mount the /api/signup POST route in Express
app.post('/api/signup', (req, res) => {
  // Parse JSON body if not already handled
  if (!req.body || Object.keys(req.body).length === 0) {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try {
        req.body = JSON.parse(data);
        signupHandler(req, res);
      } catch (e) {
        res.status(400).json({ error: 'Invalid JSON' });
      }
    });
  } else {
    signupHandler(req, res);
  }
});

// Fallback to index.html for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const PORT = process.env.PORT || 80;
app.listen(PORT, () => console.log(`Express server running on port ${PORT}`));
