import XLSX from 'xlsx';
import { MongoClient } from 'mongodb';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

console.log('🚀 Starting mol_price import...');

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

async function simpleImport() {
  try {
    console.log('📁 Checking if mol_price.xlsx exists...');
    if (!fs.existsSync('./mol_price.xlsx')) {
      throw new Error('mol_price.xlsx not found in current directory');
    }
    console.log('✅ File found');

    console.log('📖 Reading Excel file...');
    const workbook = XLSX.readFile('./mol_price.xlsx');
    console.log('📄 Available sheets:', workbook.SheetNames);
    
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet);
    
    console.log(`📊 Found ${jsonData.length} rows`);
    
    if (jsonData.length > 0) {
      console.log('📋 First row sample:');
      console.log(JSON.stringify(jsonData[0], null, 2));
    }

    console.log('🔌 Connecting to MongoDB...');
    await client.connect();
    console.log('✅ Connected to MongoDB');

    const db = client.db();
    const collection = db.collection('mol_price');

    console.log('🗑️  Clearing existing data...');
    await collection.deleteMany({});

    console.log('💾 Inserting new data...');
    const result = await collection.insertMany(jsonData.map(row => ({
      ...row,
      importedAt: new Date()
    })));

    console.log(`✅ Successfully imported ${result.insertedCount} records`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.close();
    console.log('🔌 Connection closed');
  }
}

simpleImport();
