import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// MongoDB connection
const uri = process.env.MONGODB_URI || 'mongodb+srv://antongenis1:Ag06086!@cluster0.kf4ql.mongodb.net/';
const client = new MongoClient(uri);

async function checkMolPriceCollection() {
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');
    
    const db = client.db();
    const molPriceCollection = db.collection('mol_price');
    
    // Check if collection exists and count documents
    const count = await molPriceCollection.countDocuments();
    console.log(`📊 mol_price collection has ${count} documents`);
    
    if (count > 0) {
      // Show first few documents as sample
      const sampleDocs = await molPriceCollection.find({}).limit(3).toArray();
      console.log('\n📋 Sample documents:');
      sampleDocs.forEach((doc, index) => {
        console.log(`\nDocument ${index + 1}:`);
        console.log(JSON.stringify(doc, null, 2));
      });
      
      // Show available fields
      if (sampleDocs.length > 0) {
        const fields = Object.keys(sampleDocs[0]);
        console.log('\n🏷️  Available fields:', fields);
      }
    } else {
      console.log('⚠️  Collection is empty');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.close();
    console.log('\n🔌 MongoDB connection closed');
  }
}

checkMolPriceCollection();
