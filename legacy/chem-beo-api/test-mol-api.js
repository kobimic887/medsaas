import https from 'https';
import fetch from 'node-fetch';

// Since we're using self-signed certificates, we need to ignore SSL verification for testing
process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;

const BASE_URL = 'https://localhost:3000';

async function testAPI(endpoint, description) {
  try {
    console.log(`\n🧪 Testing: ${description}`);
    console.log(`📡 GET ${BASE_URL}${endpoint}`);
    
    const response = await fetch(`${BASE_URL}${endpoint}`);
    const data = await response.json();
    
    if (response.ok) {
      console.log(`✅ Status: ${response.status}`);
      if (Array.isArray(data)) {
        console.log(`📊 Returned ${data.length} items`);
        if (data.length > 0) {
          console.log(`📋 Sample item:`, JSON.stringify(data[0], null, 2));
        }
      } else {
        console.log(`📋 Response:`, JSON.stringify(data, null, 2));
      }
    } else {
      console.log(`❌ Error: ${response.status} - ${JSON.stringify(data)}`);
    }
  } catch (error) {
    console.log(`💥 Request failed: ${error.message}`);
  }
}

async function runTests() {
  console.log('🚀 Testing mol_price API endpoints...\n');
  
  // Test basic endpoints
  await testAPI('/api/mol-price', 'Get all molecules (first 10)');
  await testAPI('/api/mol-price?limit=3', 'Get first 3 molecules');
  await testAPI('/api/mol-price/count', 'Get total count');
  
  // Test search endpoints
  await testAPI('/api/mol-price/search?query=methyl', 'Search for "methyl"');
  await testAPI('/api/mol-price/search?smiles=C', 'Search by SMILES containing "C"');
  
  // Test specific ID
  await testAPI('/api/mol-price/ASN%2010813910', 'Get specific molecule by ID');
  
  // Test price filtering
  await testAPI('/api/mol-price/price-range?min=100&max=150', 'Price range 100-150');
  
  // Test molecular weight filtering  
  await testAPI('/api/mol-price/molecular-weight?min=300&max=400', 'Molecular weight 300-400');
  
  console.log('\n✨ Testing completed!');
}

runTests();
