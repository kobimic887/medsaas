import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

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
