import https from 'https';

// Create HTTPS agent that ignores self-signed certificates
const agent = new https.Agent({
  rejectUnauthorized: false
});

function testEndpoint(path, description) {
  return new Promise((resolve) => {
    console.log(`\n🧪 Testing: ${description}`);
    console.log(`📡 GET https://localhost:3000${path}`);
    
    const options = {
      hostname: '127.0.0.1',
      port: 3000,
      path: path,
      method: 'GET',
      agent: agent
    };

    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          console.log(`✅ Status: ${res.statusCode}`);
          
          if (Array.isArray(jsonData)) {
            console.log(`📊 Returned ${jsonData.length} items`);
            if (jsonData.length > 0) {
              console.log(`📋 Sample:`, JSON.stringify(jsonData[0], null, 2));
            }
          } else {
            console.log(`📋 Response:`, JSON.stringify(jsonData, null, 2));
          }
        } catch (error) {
          console.log(`📋 Raw response:`, data);
        }
        resolve();
      });
    });

    req.on('error', (error) => {
      console.log(`❌ Error: ${error.message}`);
      resolve();
    });

    req.setTimeout(5000, () => {
      console.log(`⏱️  Request timeout`);
      req.destroy();
      resolve();
    });

    req.end();
  });
}

async function runTests() {
  console.log('🚀 Testing API endpoints...\n');
  
  // Test basic endpoints
  await testEndpoint('/api/mol-price/count', 'Get total count');
  await testEndpoint('/api/mol-price?limit=2', 'Get first 2 molecules');
  await testEndpoint('/api/mol-price/search?query=methyl', 'Search for "methyl"');
  await testEndpoint('/api/mol-price/ASN%2010813910', 'Get specific molecule by ID');
  await testEndpoint('/api/mol-price-stats', 'Get collection statistics');
  
  console.log('\n✨ Testing completed!');
}

runTests();
