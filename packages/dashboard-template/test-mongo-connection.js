const { MongoClient } = require('mongodb');

const uri = 'mongodb+srv://antongenis1:Ag06086!@cluster0.kf4ql.mongodb.net/';
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
