import fs from 'fs';
import https from 'https';
import http from 'http';

// Load SSL certificates with fallback options
export function loadSSLCertificates() {
  const certPaths = [
    {
      key: '/etc/letsencrypt/live/app.pyxis-discovery.com/privkey.pem',
      cert: '/etc/letsencrypt/live/app.pyxis-discovery.com/fullchain.pem',
      name: 'Let\'s Encrypt'
    },
    {
      key: '/etc/ssl/pyxis-combined/privkey.pem',
      cert: '/etc/ssl/pyxis-combined/fullchain.pem',
      name: 'Combined Certificate'
    },
    {
      key: './ssl/privkey.pem',
      cert: './ssl/fullchain.pem',
      name: 'Local SSL'
    }
  ];

  for (const certPath of certPaths) {
    try {
      if (fs.existsSync(certPath.key) && fs.existsSync(certPath.cert)) {
        console.log(`✓ Loading ${certPath.name} certificates`);
        return {
          key: fs.readFileSync(certPath.key, 'utf8'),
          cert: fs.readFileSync(certPath.cert, 'utf8')
        };
      }
    } catch (error) {
      console.log(`✗ Failed to load ${certPath.name}: ${error.message}`);
    }
  }
  return null;
}

// Start server with SSL and HTTP fallback
export function startServer(app, PORT) {
  // Try HTTPS first (for production), fallback to HTTP (for development)
  try {
    const httpsOptions = loadSSLCertificates();
    
    if (httpsOptions) {
      https.createServer(httpsOptions, app).listen(PORT, '0.0.0.0', () => {
        console.log(`🔒 HTTPS Server running on port ${PORT}`);
        console.log(`   Local: https://localhost:${PORT}`);
        console.log(`   Network: https://app.pyxis-discovery.com:${PORT}`);
      });
    } else {
      throw new Error('No SSL certificates found');
    }
  } catch (error) {
    console.log('SSL certificates not found, starting HTTP server for development...');
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🌐 HTTP Server running on port ${PORT}`);
      console.log(`   Local: http://localhost:${PORT}`);
      console.log(`   Network: http://app.pyxis-discovery.com:${PORT}`);
    });
  }
}
