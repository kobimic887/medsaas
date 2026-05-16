import XLSX from 'xlsx';
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// MongoDB connection
const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/yourdbname';
const client = new MongoClient(uri);

async function importExcelToMongoDB(excelFilePath) {
  try {
    // Connect to MongoDB
    await client.connect();
    console.log('✅ Connected to MongoDB');
    
    const db = client.db();
    const molPriceCollection = db.collection('mol_price');
    
    // Check if file exists
    if (!fs.existsSync(excelFilePath)) {
      throw new Error(`Excel file not found: ${excelFilePath}`);
    }
    
    console.log(`📖 Reading Excel file: ${excelFilePath}`);
    
    // Read the Excel file
    const workbook = XLSX.readFile(excelFilePath);
    const sheetName = workbook.SheetNames[0]; // Use the first sheet
    const worksheet = workbook.Sheets[sheetName];
    
    // Convert to JSON
    const jsonData = XLSX.utils.sheet_to_json(worksheet);
    
    console.log(`📊 Found ${jsonData.length} rows in Excel file`);
    
    if (jsonData.length === 0) {
      console.log('⚠️  No data found in Excel file');
      return;
    }
    
    // Show sample of the data structure
    console.log('📋 Sample data structure:');
    console.log(JSON.stringify(jsonData[0], null, 2));
    
    // Clear existing data (optional - remove this if you want to append)
    const existingCount = await molPriceCollection.countDocuments();
    if (existingCount > 0) {
      console.log(`🗑️  Found ${existingCount} existing documents. Clearing collection...`);
      await molPriceCollection.deleteMany({});
    }
    
    // Add timestamps and process data
    const processedData = jsonData.map(row => ({
      ...row,
      createdAt: new Date(),
      updatedAt: new Date()
    }));
    
    // Insert data into MongoDB
    console.log('💾 Inserting data into MongoDB...');
    const result = await molPriceCollection.insertMany(processedData);
    
    console.log(`✅ Successfully imported ${result.insertedCount} records to mol_price collection`);
    
    // Create indexes for better performance (adjust field names as needed)
    console.log('🔧 Creating indexes...');
    
    // Example indexes - adjust based on your actual column names
    const sampleKeys = Object.keys(jsonData[0]);
    console.log('Available columns:', sampleKeys);
    
    // Create basic indexes on common fields (adjust these based on your actual data)
    try {
      if (sampleKeys.includes('id') || sampleKeys.includes('ID')) {
        await molPriceCollection.createIndex({ [sampleKeys.find(k => k.toLowerCase() === 'id')]: 1 });
      }
      if (sampleKeys.includes('name') || sampleKeys.includes('Name')) {
        await molPriceCollection.createIndex({ [sampleKeys.find(k => k.toLowerCase() === 'name')]: 1 });
      }
      if (sampleKeys.includes('price') || sampleKeys.includes('Price')) {
        await molPriceCollection.createIndex({ [sampleKeys.find(k => k.toLowerCase() === 'price')]: 1 });
      }
      console.log('✅ Indexes created successfully');
    } catch (indexError) {
      console.log('⚠️  Could not create some indexes:', indexError.message);
    }
    
  } catch (error) {
    console.error('❌ Error importing Excel file:', error.message);
    throw error;
  } finally {
    await client.close();
    console.log('🔌 MongoDB connection closed');
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node import-mol-price.js <path-to-excel-file>');
    console.log('Example: node import-mol-price.js ./mol_price_data.xlsx');
    process.exit(1);
  }
  
  const excelFilePath = path.resolve(args[0]);
  
  try {
    await importExcelToMongoDB(excelFilePath);
    console.log('🎉 Import completed successfully!');
  } catch (error) {
    console.error('💥 Import failed:', error.message);
    process.exit(1);
  }
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { importExcelToMongoDB };
