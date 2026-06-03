import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/yourdbname';
const client = new MongoClient(uri);
let usersCollection;

// Robust middleware to ensure MongoDB connection and usersCollection
export async function ensureMongoConnected(req, res, next) {
  try {
    if (!client.topology || !client.topology.isConnected()) {
      await client.connect();
    }
    usersCollection = client.db().collection('users');
    next();
  } catch (err) {
    console.error('MongoDB connection error:', err);
    return res.status(500).json({ error: 'MongoDB connection error' });
  }
}

// Get database client
export function getDbClient() {
  return client;
}

// Get users collection
export function getUsersCollection() {
  return usersCollection;
}

// Get any collection by name
export function getCollection(name) {
  return client.db().collection(name);
}

export { client, usersCollection };
