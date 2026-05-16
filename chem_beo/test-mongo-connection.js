const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/yourdbname';
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });

async function testConnection() {
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB successfully!');
    await client.close();
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
  }
}

testConnection();
