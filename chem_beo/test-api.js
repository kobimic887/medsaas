import fetch from 'node-fetch';
import https from 'https';

// Create an agent that ignores SSL certificate errors for testing
const agent = new https.Agent({
  rejectUnauthorized: false
});

async function testAPI() {
  const baseUrl = 'http://localhost:4000';
  
  console.log('🧪 Testing mol_price API endpoints...\n');
  
  try {
    // Test 1: Get all molecules (limited)
    console.log('1️⃣ Testing GET /api/mol-price (first 5 molecules)');
    const response1 = await fetch(`${baseUrl}/api/mol-price?limit=5`);
    const data1 = await response1.json();
    console.log(`✅ Status: ${response1.status}`);
    console.log(`📊 Found ${data1.molecules.length} molecules`);
    console.log(`📄 Total in database: ${data1.pagination.total}`);
    if (data1.molecules.length > 0) {
      console.log(`🧬 First molecule: ${data1.molecules[0].ASINEX_ID}`);
    }
    console.log('');

    // Test 2: Search by ASINEX_ID
    console.log('2️⃣ Testing search by ASINEX_ID');
    const response2 = await fetch(`${baseUrl}/api/mol-price/search?asinex_id=ASN 10813910`);
    const data2 = await response2.json();
    console.log(`✅ Status: ${response2.status}`);
    console.log(`🔍 Search results: ${data2.molecules.length} molecules found`);
    if (data2.molecules.length > 0) {
      console.log(`💰 Price 1mg: $${data2.molecules[0].PRICE_1MG}`);
    }
    console.log('');

    // Test 3: Search by molecular weight range
    console.log('3️⃣ Testing molecular weight range search (300-400)');
    const response3 = await fetch(`${baseUrl}/api/mol-price/search?min_mw=300&max_mw=400`);
    const data3 = await response3.json();
    console.log(`✅ Status: ${response3.status}`);
    console.log(`⚖️ Found ${data3.molecules.length} molecules in MW range 300-400`);
    console.log('');

    console.log('🎉 Basic API tests completed successfully!');

  } catch (error) {
    console.error('❌ Error testing APIs:', error.message);
    console.log('\n💡 Make sure the server is running with: node test-server.js');
  }
}

testAPI();
