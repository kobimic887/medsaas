// mongo.js
const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/yourdbname';
const client = new MongoClient(uri);

async function connectMongo() {
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    // You can now use client.db() to access your database
  } catch (err) {
    console.error('MongoDB connection error:', err);
  }
}

module.exports = { connectMongo, client };