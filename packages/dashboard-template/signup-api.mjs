import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';
import express from 'express';
import cors from 'cors';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const client = new MongoClient(process.env.MONGODB_URI);
let db;

client.connect().then(() => {
  db = client.db();
  console.log('Connected to MongoDB for signup!');
});

app.post('/api/signup', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  try {
    const users = db.collection('users');
    const existing = await users.findOne({ email });
    if (existing) {
      return res.status(409).json({ error: 'Email already registered.' });
    }
    // In production, hash the password!
    await users.insertOne({ email, password });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.SIGNUP_PORT || 4000;
app.listen(PORT, () => console.log(`Signup API running on port ${PORT}`));
