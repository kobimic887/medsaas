import { createRequire } from "node:module";

const requireFromServer = createRequire(new URL("../server/package.json", import.meta.url));
const { MongoClient } = requireFromServer("mongodb");

const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017/bun_spike_test";
const dbName = process.env.MONGODB_SPIKE_DB || "bun_spike_test";
const collectionName = "compatibility_probe";
const client = new MongoClient(mongoUri, {
  serverSelectionTimeoutMS: 10_000,
});

try {
  await client.connect();

  const db = client.db(dbName);
  const collection = db.collection(collectionName);
  const marker = `bun-mongo-${Date.now()}`;
  const document = {
    marker,
    runtime: "bun",
    createdAt: new Date(),
  };

  const insertResult = await collection.insertOne(document);
  const found = await collection.findOne({ _id: insertResult.insertedId });

  if (!found || found.marker !== marker) {
    throw new Error("Inserted document was not found with the expected marker");
  }

  const indexName = await collection.createIndex({ marker: 1 }, { unique: true });

  console.log(`MongoDB inserted _id: ${insertResult.insertedId.toString()}`);
  console.log(`MongoDB found marker: ${found.marker}`);
  console.log(`MongoDB created index: ${indexName}`);
} finally {
  try {
    await client.db(dbName).dropDatabase();
    console.log(`MongoDB dropped throwaway database: ${dbName}`);
  } finally {
    await client.close();
  }
}
