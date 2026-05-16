import express from 'express';
import cors from 'cors';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);
let molPriceCollection;

// Middleware to ensure MongoDB connection
async function ensureMongoConnected(req, res, next) {
  try {
    if (!client.topology || !client.topology.isConnected()) {
      await client.connect();
    }
    molPriceCollection = client.db().collection('mol_price');
    next();
  } catch (err) {
    console.error('MongoDB connection error:', err);
    return res.status(500).json({ error: 'MongoDB connection error' });
  }
}

// GET all molecules with pagination and basic filtering
app.get('/api/mol-price', ensureMongoConnected, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const molecules = await molPriceCollection
      .find({})
      .skip(skip)
      .limit(limit)
      .toArray();

    const total = await molPriceCollection.countDocuments();

    res.json({
      molecules,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = 4000;
app.listen(PORT, () => {
  console.log(`🚀 Test server running on http://localhost:${PORT}`);
});
