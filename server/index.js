import https from 'https';
import fs from 'fs';
import axios from 'axios';
import { execFile } from 'child_process';
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import FormData from 'form-data';
import { MongoClient, ObjectId } from 'mongodb';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';
import 'dotenv/config';
import { configDotenv } from 'dotenv';
import Stripe from 'stripe';
import path from 'path';
import { fileURLToPath } from 'url';
import dns from 'dns/promises';
import net from 'net';
import os from 'os';

import crypto from 'crypto';

// Import email templates
import { generatePasswordResetEmailHTML, generateInviteEmailHTML } from './utils/emailTemplates.js';
import { getBrandName, getPlatformName, getPlatformWebsiteUrl } from './config/branding.js';
import { sendTitanEmail, testEmailConfiguration } from './utils/emailService.js';
import { validateEmailCredentials, getTitanMailHelp } from './utils/emailDebug.js';
import { createAdmetTask, getQueueStatus, rabbitMQHealthCheck } from './utils/rabbitMQUtils.js';
import {
  DEFAULT_BRAND_PALETTE,
  extractBrandPalette,
  normalizeBrandPalette,
  parseAndNormalizeLogoUpload,
  serializeCompanyBranding
} from './utils/companyBranding.js';
import scientificServicesRouter from './routes/scientificServices.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
configDotenv({ path: path.resolve(__dirname, '../.env') });
configDotenv();

const REQUIRED_ENV = ['MONGODB_URI', 'JWT_SECRET', 'STRIPE_SECRET_KEY'];
const missingRequiredEnv = REQUIRED_ENV.filter((key) => !process.env[key]);

if (missingRequiredEnv.length > 0) {
  console.error(`Missing required environment variables: ${missingRequiredEnv.join(', ')}`);
  console.error('Create a root .env file from .env.example before starting the app.');
  process.exit(1);
}

if (process.env.JWT_SECRET.length < 32) {
  console.error('JWT_SECRET must be at least 32 characters.');
  process.exit(1);
}

const JWT_SECRET = process.env.JWT_SECRET;
// Session token lifetime. Override with JWT_EXPIRES_IN (any value accepted by
// jsonwebtoken's `expiresIn`, e.g. '12h', '7d', '30d'). Defaults to 7 days so a
// login doesn't silently die after 24h; the client also auto-redirects to
// sign-in on a 401 when a token does expire.
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
// Treat the .env.example placeholder as "not configured" so the webhook fails
// with a clear message instead of a confusing signature-verification error.
const RAW_STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_WEBHOOK_SECRET = /replace[_-]?me/i.test(RAW_STRIPE_WEBHOOK_SECRET)
  ? ''
  : RAW_STRIPE_WEBHOOK_SECRET;
if (!STRIPE_WEBHOOK_SECRET) {
  console.warn('[stripe] STRIPE_WEBHOOK_SECRET is not set — payment webhooks will be rejected and credits will NOT be granted until it is configured.');
}
const MONGODB_URI = process.env.MONGODB_URI;
const APP_BASE_URL = (process.env.BASE_URL || '').replace(/\/$/, '');
const FRONTEND_URL = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
const TANIMOTO_API_BASE = (process.env.TANIMOTO_API_BASE || 'http://151.145.91.17:8000').replace(/\/$/, '');
const SDF_CONVERTER_URL = process.env.SDF_CONVERTER_URL || 'http://83.229.87.94:8001/convertSTR';
// Default ligand catalog/docking endpoints. Companies override these per-company
// from Company Admin; env vars (if set) seed the defaults for backward compatibility.
const DEFAULT_LIGAND_SERVICE_CONFIG = Object.freeze({
  catalogApiBase: (process.env.ASINEX_API_BASE || 'http://dev.asinex.com:58181').replace(/\/$/, ''),
  stockApiUrl: process.env.ASINEX_STOCK_API_URL || 'https://stock.asinex.com:5443/api/Shop',
  dockingApiUrl: process.env.ASINEX_DOCKING_API_URL || 'https://services.asinex.com:8000/docking',
  diffdockApiUrl: process.env.DIFFDOCK_API_URL || 'https://services.asinex.com:58000/molecular-docking/diffdock/generate'
});

const PLAN_CATALOG = Object.freeze({
  Trial: { displayName: 'Trial', credits: 4, priceCents: 0 },
  Standard: { displayName: 'Standard', credits: 50, priceCents: 2000 },
  Academic: { displayName: 'Academic', credits: 300, priceCents: 4000 },
  Professional: { displayName: 'Professional', credits: 720, priceCents: 8000 }
});
const PASSWORD_POLICY = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/;

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const FRONTEND_DIST_PATH = path.resolve(
  __dirname,
  process.env.FRONTEND_DIST || '../client/dist'
);
const FRONTEND_INDEX_PATH = path.join(FRONTEND_DIST_PATH, 'index.html');
const hasFrontendBuild = () => fs.existsSync(FRONTEND_INDEX_PATH);

const app = express();

app.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!STRIPE_WEBHOOK_SECRET) {
    return res.status(500).json({ error: 'STRIPE_WEBHOOK_SECRET is not configured' });
  }

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      req.body,
      req.headers['stripe-signature'],
      STRIPE_WEBHOOK_SECRET
    );
  } catch (error) {
    console.error('Stripe webhook signature verification failed:', error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      await fulfillCheckoutSession(event.data.object);
    }
    res.json({ received: true });
  } catch (error) {
    console.error('Stripe webhook fulfillment failed:', error);
    res.status(500).json({ error: 'Webhook fulfillment failed' });
  }
});

const allowedOrigins = new Set([APP_BASE_URL, FRONTEND_URL].filter(Boolean));

app.use(express.json({ limit: '8mb' }));
app.use(cors({
  origin(origin, callback) {
    // No Origin header (same-origin requests, curl, server-to-server) — allow.
    if (!origin) return callback(null, true);
    if (allowedOrigins.has(origin)) return callback(null, true);
    // An empty allowlist used to reflect ANY origin with credentials. Only keep
    // that permissive behavior outside production (local dev convenience); in
    // production an unconfigured allowlist must not turn into allow-all.
    if (allowedOrigins.size === 0 && process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    return callback(new Error('CORS origin is not allowed'));
  },
  credentials: true
}));
app.use('/blobs', express.static(path.join(__dirname, 'blobs')));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // SAMEORIGIN (not DENY) so the dashboard can embed the same-origin Ketcher
  // (/ketcher/index.html) editor and Molstar (/molstar/index.html) viewer iframes.
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

function createRateLimiter({ windowMs, max, name }) {
  const hits = new Map();

  return (req, res, next) => {
    const now = Date.now();
    const key = `${name}:${req.ip || req.socket.remoteAddress || 'unknown'}`;
    const record = hits.get(key) || { count: 0, resetAt: now + windowMs };

    if (record.resetAt <= now) {
      record.count = 0;
      record.resetAt = now + windowMs;
    }

    record.count += 1;
    hits.set(key, record);

    if (record.count > max) {
      res.setHeader('Retry-After', Math.ceil((record.resetAt - now) / 1000));
      return res.status(429).json({ error: 'Too many requests. Please retry later.' });
    }

    next();
  };
}

const authRateLimit = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 30, name: 'auth' });
const publicEmailRateLimit = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 5, name: 'public-email' });
const checkoutRateLimit = createRateLimiter({ windowMs: 5 * 60 * 1000, max: 20, name: 'checkout' });

/**
 * @swagger
 * /api/generate-molecules:
 *   post:
 *     summary: Generate molecules using NVIDIA Health API
 *     tags:
 *       - Simulations
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               smi:
 *                 type: string
 *                 description: SMILES string
 *               min_similarity:
 *                 type: number
 *                 description: Minimum similarity
 *               num_molecules:
 *                 type: integer
 *                 description: Number of molecules
 *     responses:
 *       200:
 *         description: Molecules generated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 */
app.post('/api/generate-molecules', ensureMongoConnected, authenticateToken, requireActiveUser, consumeSimulationToken('generate-molecules'), async (req, res) => {
  const molmimApiKey = process.env.NVIDIA_MOLMIM_API_KEY;
  if (!molmimApiKey) {
    return res.status(500).json({ error: 'NVIDIA_MOLMIM_API_KEY is not configured' });
  }

  const {   smiles,
            minSimilarity,
            numMolecules } = req.body;
  const invoke_url = 'https://health.api.nvidia.com/v1/biology/nvidia/molmim/generate';
  const headers = {
    'Authorization': `Bearer ${molmimApiKey}`,
    'Accept': 'application/json',
  };
  const payload = {
    algorithm: 'CMA-ES',
    num_molecules: numMolecules || 30,
    property_name: 'QED',
    minimize: false,
    min_similarity: minSimilarity || 0.3,
    particles: 30,
    iterations: 10,
    smi: smiles ,
  };
  try {
    const response = await axios.post(invoke_url, payload, { headers });
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});


/**
 * @swagger
 * /api/openfold3/predict:
 *   post:
 *     summary: Predict biomolecular complex structure using OpenFold3
 *     description: Proxies requests to NVIDIA NIM OpenFold3 API for protein/DNA/RNA/ligand structure prediction
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Predicted structure in PDB or mmCIF format
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 */
app.post("/api/openfold3/predict", ensureMongoConnected, authenticateToken, requireActiveUser, consumeSimulationToken('openfold3'), async (req, res) => {
  const openfoldApiKey = process.env.NVIDIA_OPENFOLD_API_KEY;
  if (!openfoldApiKey) {
    return res.status(500).json({ error: 'NVIDIA_OPENFOLD_API_KEY is not configured' });
  }

  const invoke_url =
    "https://health.api.nvidia.com/v1/biology/openfold/openfold3/predict";
  const headers = {
    Authorization: `Bearer ${openfoldApiKey}`,
    "Content-Type": "application/json",
    "NVCF-POLL-SECONDS": "300",
  };
  try {
    const response = await axios.post(invoke_url, req.body, {
      headers,
      timeout: 600000,
    });
    res.json(response.data);
  } catch (error) {
    console.error(
      "OpenFold3 API error:",
      error.response?.data || error.message,
    );
    res.status(error.response?.status || 500).json({
      error: error.message,
      details: error.response?.data || null,
    });
  }
});



// Add a basic health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString(), message: 'Server is running' });
});

// Add a database health check endpoint
app.get('/health/db', async (req, res) => {
  try {
    await client.db().admin().ping();
    const dbStats = await client.db().stats();
    res.json({ 
      status: 'OK', 
      database: 'connected',
      dbName: client.db().databaseName,
      collections: dbStats.collections,
      timestamp: new Date().toISOString() 
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'ERROR', 
      database: 'disconnected',
      error: error.message,
      timestamp: new Date().toISOString() 
    });
  }
});

// Root route serves frontend if available; falls back to API docs
app.get('/', (req, res) => {
  if (hasFrontendBuild()) {
    return res.sendFile(FRONTEND_INDEX_PATH);
  }
  res.redirect('/api-docs');
});

// --- Wrappers for the configured Tanimoto search service ---

// Health check
/**
 * @swagger
 * /tanimoto/health:
 *   get:
 *     summary: Health check for Tanimoto API
 *     tags: [Tanimoto]
 *     responses:
 *       200:
 *         description: Health status
 */
app.get('/tanimoto/health', ensureMongoConnected, authenticateToken, requireActiveUser, async (req, res) => {
  try {
    const response = await axios.get(`${TANIMOTO_API_BASE}/health`);
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// Upload CSV
/**
 * @swagger
 * /tanimoto/v1/upload:
 *   post:
 *     summary: Upload a CSV file containing SMILES and metadata
 *     tags: [Tanimoto]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Upload response
 */
app.post('/tanimoto/v1/upload', ensureMongoConnected, authenticateToken, requireActiveUser, async (req, res) => {
  try {
    const response = await axios.post(`${TANIMOTO_API_BASE}/v1/upload`, req.body, {
      headers: { 'Content-Type': 'application/json' },
    });
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// Exact molecule match
/**
 * @swagger
 * /tanimoto/v1/search/exact:
 *   get:
 *     summary: Exact molecule match search
 *     tags: [Tanimoto]
 *     parameters:
 *       - in: query
 *         name: smiles
 *         schema:
 *           type: string
 *         description: SMILES string to match
 *     responses:
 *       200:
 *         description: Exact match result
 */
app.get('/tanimoto/v1/search/exact', ensureMongoConnected, authenticateToken, requireActiveUser, async (req, res) => {
  try {
    const response = await axios.get(`${TANIMOTO_API_BASE}/v1/search/exact`, { params: req.query });
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// Tanimoto similarity search
/**
 * @swagger
 * /tanimoto/v1/search/similarity:
 *   get:
 *     summary: Tanimoto similarity search
 *     tags: [Tanimoto]
 *     parameters:
 *       - in: query
 *         name: smiles
 *         schema:
 *           type: string
 *         description: SMILES string to search
 *       - in: query
 *         name: threshold
 *         schema:
 *           type: number
 *         description: Similarity threshold
 *       - in: query
 *         name: fingerprint_type
 *         schema:
 *           type: string
 *           enum: [morgan, maccs, feat_morgan, atom_pair, torsion, rdkit]
 *         description: Fingerprint type
 *       - in: query
 *         name: similarity_metric
 *         schema:
 *           type: string
 *           enum: [tanimoto, dice]
 *         description: Similarity metric
 *     responses:
 *       200:
 *         description: Similarity search result
 */
app.get('/tanimoto/v1/search/similarity', ensureMongoConnected, authenticateToken, requireActiveUser, async (req, res) => {
  try {
    const response = await axios.get(`${TANIMOTO_API_BASE}/v1/search/similarity`, { params: req.query });
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// Substructure search
/**
 * @swagger
 * /tanimoto/v1/search/substructure:
 *   get:
 *     summary: Substructure search
 *     tags: [Tanimoto]
 *     parameters:
 *       - in: query
 *         name: smiles
 *         schema:
 *           type: string
 *         description: SMILES string to search
 *     responses:
 *       200:
 *         description: Substructure search result
 */
app.get('/tanimoto/v1/search/substructure', ensureMongoConnected, authenticateToken, requireActiveUser, async (req, res) => {
  try {
    const response = await axios.get(`${TANIMOTO_API_BASE}/v1/search/substructure`, { params: req.query });
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// Batch search
/**
 * @swagger
 * /tanimoto/v1/search/batch:
 *   post:
 *     summary: Batch search for molecules
 *     tags: [Tanimoto]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               queries:
 *                 type: array
 *                 items:
 *                   type: string
 *               search_type:
 *                 type: string
 *                 enum: [exact, similarity, substructure]
 *               threshold:
 *                 type: number
 *               fingerprint_type:
 *                 type: string
 *                 enum: [morgan, maccs, feat_morgan, atom_pair, torsion, rdkit]
 *               similarity_metric:
 *                 type: string
 *                 enum: [tanimoto, dice]
 *     responses:
 *       200:
 *         description: Batch search result
 */
app.post('/tanimoto/v1/search/batch', ensureMongoConnected, authenticateToken, requireActiveUser, async (req, res) => {
  try {
    const response = await axios.post(`${TANIMOTO_API_BASE}/v1/search/batch`, req.body, {
      headers: { 'Content-Type': 'application/json' },
    });
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// List all datasets
/**
 * @swagger
 * /tanimoto/v1/datasets:
 *   get:
 *     summary: List all datasets
 *     tags: [Tanimoto]
 *     responses:
 *       200:
 *         description: List of datasets
 */
app.get('/tanimoto/v1/datasets', ensureMongoConnected, authenticateToken, requireActiveUser, async (req, res) => {
  try {
    const response = await axios.get(`${TANIMOTO_API_BASE}/v1/datasets`, { params: req.query });
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// Get dataset details
/**
 * @swagger
 * /tanimoto/v1/datasets/{dataset_id}:
 *   get:
 *     summary: Get dataset details
 *     tags: [Tanimoto]
 *     parameters:
 *       - in: path
 *         name: dataset_id
 *         required: true
 *         schema:
 *           type: string
 *         description: Dataset ID
 *     responses:
 *       200:
 *         description: Dataset details
 */
app.get('/tanimoto/v1/datasets/:dataset_id', ensureMongoConnected, authenticateToken, requireActiveUser, async (req, res) => {
  try {
    const response = await axios.get(`${TANIMOTO_API_BASE}/v1/datasets/${req.params.dataset_id}`);
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// Delete a dataset
/**
 * @swagger
 * /tanimoto/v1/datasets/{dataset_id}:
 *   delete:
 *     summary: Delete a dataset
 *     tags: [Tanimoto]
 *     parameters:
 *       - in: path
 *         name: dataset_id
 *         required: true
 *         schema:
 *           type: string
 *         description: Dataset ID
 *     responses:
 *       200:
 *         description: Dataset deleted
 */
app.delete('/tanimoto/v1/datasets/:dataset_id', ensureMongoConnected, authenticateToken, requireActiveUser, async (req, res) => {
  try {
    const response = await axios.delete(`${TANIMOTO_API_BASE}/v1/datasets/${req.params.dataset_id}`);
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Chem API',
      version: '1.0.0',
      description: 'API documentation for Chem project - Molecular research platform with pricing, simulations, and user management',
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Local HTTP server'
      },
      {
        url: 'https://localhost:3000',
        description: 'Local HTTPS server'
      },
      {
        url: 'https://your-domain.com:3000',
        description: 'Production server'
      }
    ],
    tags: [
      {
        name: 'Authentication',
        description: 'User authentication and token management'
      },
      {
        name: 'Mol Price',
        description: 'Molecular compound pricing and search'
      },
      {
        name: 'Simulations',
        description: 'Molecular docking simulations'
      },
      {
        name: 'Projects',
        description: 'User project management'
      },
      {
        name: 'Payments',
        description: 'Stripe payment processing'
      },
      {
        name: 'Email',
        description: 'Email services'
      },
      {
        name: 'Asinex Wrapper',
        description: 'Wrapper endpoints for Asinex external API'
      },
      {
        name: 'Asinex Direct API',
        description: 'Direct proxy endpoints to Asinex API with exact same structure'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./index.js'],
};

// Generate Swagger spec with error handling
let swaggerSpec;
try {
  swaggerSpec = swaggerJsdoc(swaggerOptions);
  console.log('✓ Swagger spec generated successfully');
  console.log('📚 API Documentation available at:');
  console.log('  - http://localhost:3000/api-docs');
  console.log('  - http://localhost:3000/api/docs');
} catch (error) {
  console.error('❌ Error generating Swagger spec:', error.message);
  // Create a minimal spec as fallback
  swaggerSpec = {
    openapi: '3.0.0',
    info: {
      title: 'Chem API',
      version: '1.0.0',
      description: 'API documentation (minimal fallback)'
    },
    paths: {}
  };
}

// Mount Swagger UI on both routes for flexibility
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Add a route to serve the raw OpenAPI spec
app.get('/api/openapi.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

const uri = MONGODB_URI;
const client = new MongoClient(uri);
let usersCollection;
let companiesCollection;
let auditLogsCollection;
let billingEventsCollection;

// Initialize database connection
async function initializeDatabase() {
  try {
    console.log('Initializing database connection...');
    console.log('MongoDB URI:', uri.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@')); // Hide credentials
    
    await client.connect();
    await client.db().admin().ping();
    
    console.log('✓ Connected to MongoDB successfully');
    
    // Initialize collections
    usersCollection = client.db().collection('users');
    companiesCollection = client.db().collection('companies');
    auditLogsCollection = client.db().collection('audit_logs');
    billingEventsCollection = client.db().collection('billing_events');
    
    // Create indexes if they don't exist
    try {
      await usersCollection.createIndex({ username: 1 }, { unique: true });
      await usersCollection.createIndex({ email: 1 }, { unique: true });
      await usersCollection.createIndex({ companyId: 1 });
      await companiesCollection.createIndex({ slug: 1 }, { unique: true });
      await companiesCollection.createIndex({ companyId: 1 }, { unique: true, sparse: true });
      await auditLogsCollection.createIndex({ companyId: 1, timestamp: -1 });
      await auditLogsCollection.createIndex({ actorUsername: 1, timestamp: -1 });
      await billingEventsCollection.createIndex({ stripeSessionId: 1 }, { unique: true, sparse: true });
      await billingEventsCollection.createIndex({ username: 1, createdAt: -1 });
      console.log('✓ Database indexes created/verified');
    } catch (indexErr) {
      console.log('Note: Database indexes already exist or creation failed:', indexErr.message);
    }
    
    return true;
  } catch (err) {
    console.error('❌ Failed to initialize database connection:', {
      message: err.message,
      code: err.code,
      name: err.name
    });
    
    if (err.message.includes('ECONNREFUSED')) {
      console.error('💡 Suggestion: Make sure MongoDB is running on your system');
      console.error('   - Install MongoDB: https://www.mongodb.com/try/download/community');
      console.error('   - Start MongoDB service');
      console.error('   - Or use MongoDB Atlas: https://www.mongodb.com/atlas');
    }
    
    return false;
  }
}

// Robust middleware to ensure MongoDB connection and usersCollection
async function ensureMongoConnected(req, res, next) {
  try {
    // Check if client is connected
    if (!client.topology || !client.topology.isConnected()) {
      console.log('Attempting to connect to MongoDB...');
      await client.connect();
      console.log('Connected to MongoDB successfully');
    }
    
    // Test the connection by pinging
    await client.db().admin().ping();
    
    usersCollection = client.db().collection('users');
    companiesCollection = client.db().collection('companies');
    auditLogsCollection = client.db().collection('audit_logs');
    billingEventsCollection = client.db().collection('billing_events');
    next();
  } catch (err) {
    console.error('MongoDB connection error details:', {
      message: err.message,
      code: err.code,
      uri: uri.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@'), // Hide credentials in logs
    });
    
    // Try to reconnect once
    try {
      console.log('Attempting to reconnect to MongoDB...');
      await client.close();
      await client.connect();
      await client.db().admin().ping();
      usersCollection = client.db().collection('users');
      companiesCollection = client.db().collection('companies');
      auditLogsCollection = client.db().collection('audit_logs');
      billingEventsCollection = client.db().collection('billing_events');
      console.log('Reconnected to MongoDB successfully');
      next();
    } catch (reconnectErr) {
      console.error('Failed to reconnect to MongoDB:', reconnectErr.message);
      return res.status(500).json({ 
        error: 'MongoDB connection error',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  }
}

function normalizeCompanyName(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

function toCompanySlug(name) {
  return normalizeCompanyName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildTenantFilter(user) {
  if (user?.companyId) {
    return { companyId: user.companyId };
  }
  if (user?.username) {
    return { 'user.username': user.username };
  }
  return {};
}

const DEFAULT_USAGE_POLICY = {
  monthlySimulationCap: null,
  defaultSimulationTokensPerUser: 50
};
const MAX_LIGAND_UPLOAD_BYTES = 2 * 1024 * 1024;

function normalizeLigandServiceConfig(rawConfig = {}) {
  const rawCatalogApiBase = typeof rawConfig.catalogApiBase === 'string' ? rawConfig.catalogApiBase.trim() : '';
  const rawStockApiUrl = typeof rawConfig.stockApiUrl === 'string' ? rawConfig.stockApiUrl.trim() : '';
  const rawDockingApiUrl = typeof rawConfig.dockingApiUrl === 'string' ? rawConfig.dockingApiUrl.trim() : '';
  const rawDiffdockApiUrl = typeof rawConfig.diffdockApiUrl === 'string' ? rawConfig.diffdockApiUrl.trim() : '';

  const catalogApiBase = rawCatalogApiBase
    ? rawCatalogApiBase.replace(/\/$/, '')
    : DEFAULT_LIGAND_SERVICE_CONFIG.catalogApiBase;
  const stockApiUrl = rawStockApiUrl
    ? rawStockApiUrl.replace(/\/$/, '')
    : DEFAULT_LIGAND_SERVICE_CONFIG.stockApiUrl;
  const dockingApiUrl = rawDockingApiUrl
    ? rawDockingApiUrl.replace(/\/$/, '')
    : DEFAULT_LIGAND_SERVICE_CONFIG.dockingApiUrl;
  const diffdockApiUrl = rawDiffdockApiUrl
    ? rawDiffdockApiUrl.replace(/\/$/, '')
    : DEFAULT_LIGAND_SERVICE_CONFIG.diffdockApiUrl;

  return {
    catalogApiBase,
    stockApiUrl,
    dockingApiUrl,
    diffdockApiUrl
  };
}

function getCurrentMonthKey(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function normalizeUsagePolicy(rawPolicy = {}) {
  const capRaw = rawPolicy.monthlySimulationCap;
  const defaultTokensRaw = rawPolicy.defaultSimulationTokensPerUser;

  const normalizedCap = capRaw === null || capRaw === undefined || capRaw === ''
    ? null
    : Number(capRaw);
  const normalizedDefaultTokens = Number(defaultTokensRaw);

  return {
    monthlySimulationCap: Number.isFinite(normalizedCap) && normalizedCap > 0
      ? Math.floor(normalizedCap)
      : null,
    defaultSimulationTokensPerUser: Number.isFinite(normalizedDefaultTokens) && normalizedDefaultTokens >= 0
      ? Math.floor(normalizedDefaultTokens)
      : DEFAULT_USAGE_POLICY.defaultSimulationTokensPerUser
  };
}

function normalizeMonthlyUsage(rawUsage = {}) {
  const monthKey = getCurrentMonthKey();
  if (rawUsage.monthKey !== monthKey) {
    return {
      monthKey,
      simulationsRun: 0,
      updatedAt: new Date()
    };
  }
  return {
    monthKey,
    simulationsRun: Number.isFinite(Number(rawUsage.simulationsRun))
      ? Math.max(0, Math.floor(Number(rawUsage.simulationsRun)))
      : 0,
    updatedAt: rawUsage.updatedAt || new Date()
  };
}

function parseLigandUpload(rawLigandUpload, { required = false } = {}) {
  if (!rawLigandUpload) {
    if (required) throw new Error('Ligand file upload is required');
    return null;
  }
  if (typeof rawLigandUpload !== 'object' || Array.isArray(rawLigandUpload)) {
    throw new Error('ligandUpload must be an object');
  }

  const fileName = typeof rawLigandUpload.fileName === 'string' ? rawLigandUpload.fileName.trim() : '';
  const contentType = typeof rawLigandUpload.contentType === 'string' && rawLigandUpload.contentType.trim()
    ? rawLigandUpload.contentType.trim().slice(0, 128)
    : 'application/octet-stream';
  const contentBase64 = typeof rawLigandUpload.contentBase64 === 'string'
    ? rawLigandUpload.contentBase64.trim()
    : '';

  if (!fileName) throw new Error('ligandUpload.fileName is required');
  if (!contentBase64) throw new Error('ligandUpload.contentBase64 is required');

  let decoded;
  try {
    decoded = Buffer.from(contentBase64, 'base64');
  } catch (error) {
    throw new Error(`ligandUpload.contentBase64 must be valid base64: ${error.message}`);
  }

  if (!decoded || decoded.length === 0) {
    throw new Error('Ligand upload content is empty');
  }
  if (decoded.length > MAX_LIGAND_UPLOAD_BYTES) {
    throw new Error(`Ligand file must be ${MAX_LIGAND_UPLOAD_BYTES / (1024 * 1024)}MB or smaller`);
  }

  return {
    fileName: fileName.slice(0, 255),
    contentType,
    sizeBytes: decoded.length,
    contentBase64: decoded.toString('base64'),
    uploadedAt: new Date()
  };
}

function toObjectIdSafe(value) {
  if (!value || !ObjectId.isValid(value)) return null;
  return new ObjectId(value);
}

function generateTemporaryPassword() {
  // Temporary credentials must come from a CSPRNG — Math.random()/Date.now()
  // output is predictable. The fixed affixes keep the signup password policy
  // satisfied (lower + upper + digit + special, ≥8 chars) regardless of which
  // characters the random core draws.
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let random = '';
  for (let i = 0; i < 10; i += 1) {
    random += alphabet[crypto.randomInt(alphabet.length)];
  }
  return `Tmp!${random}aA1`;
}

async function getCompanyRecord(companyId) {
  if (!companyId) return null;

  const oid = toObjectIdSafe(companyId);
  const filters = [{ companyId }];
  if (oid) filters.push({ _id: oid });

  let company = await companiesCollection.findOne({ $or: filters });
  if (!company) return null;

  const normalizedCompanyId = company.companyId || company._id.toString();
  const normalizedUsagePolicy = normalizeUsagePolicy(company.usagePolicy || {});
  const normalizedMonthlyUsage = normalizeMonthlyUsage(company.monthlyUsage || {});
  const normalizedLigandServiceConfig = normalizeLigandServiceConfig(company.ligandServiceConfig || {});

  const patch = {};
  if (!company.companyId) patch.companyId = normalizedCompanyId;
  if (!company.usagePolicy) patch.usagePolicy = normalizedUsagePolicy;
  if (!company.ligandServiceConfig) patch.ligandServiceConfig = normalizedLigandServiceConfig;
  if (!company.monthlyUsage || company.monthlyUsage.monthKey !== normalizedMonthlyUsage.monthKey) {
    patch.monthlyUsage = normalizedMonthlyUsage;
  }

  if (Object.keys(patch).length > 0) {
    patch.updatedAt = new Date();
    await companiesCollection.updateOne({ _id: company._id }, { $set: patch });
    company = { ...company, ...patch };
  }

  return {
    ...company,
    companyId: normalizedCompanyId,
    usagePolicy: normalizeUsagePolicy(company.usagePolicy || normalizedUsagePolicy),
    monthlyUsage: normalizeMonthlyUsage(company.monthlyUsage || normalizedMonthlyUsage),
    ligandServiceConfig: normalizeLigandServiceConfig(company.ligandServiceConfig || normalizedLigandServiceConfig),
    branding: {
      ...(company.branding || {}),
      palette: normalizeBrandPalette(company.branding?.palette || {}),
      isCustom: Boolean(company.branding?.palette || company.branding?.logo)
    }
  };
}

async function incrementCompanyMonthlyUsage(companyId) {
  if (!companyId) return;

  const company = await getCompanyRecord(companyId);
  if (!company) return;

  const monthKey = getCurrentMonthKey();
  if (company.monthlyUsage?.monthKey === monthKey) {
    await companiesCollection.updateOne(
      { _id: company._id },
      {
        $inc: { 'monthlyUsage.simulationsRun': 1 },
        $set: { 'monthlyUsage.updatedAt': new Date(), updatedAt: new Date() }
      }
    );
    return;
  }

  await companiesCollection.updateOne(
    { _id: company._id },
    {
      $set: {
        monthlyUsage: {
          monthKey,
          simulationsRun: 1,
          updatedAt: new Date()
        },
        updatedAt: new Date()
      }
    }
  );
}

async function getRequestLigandServiceConfig(req) {
  if (!req?.user?.companyId) {
    return { ...DEFAULT_LIGAND_SERVICE_CONFIG };
  }
  const company = await getCompanyRecord(req.user.companyId);
  if (!company) {
    return { ...DEFAULT_LIGAND_SERVICE_CONFIG };
  }
  return normalizeLigandServiceConfig(company.ligandServiceConfig || {});
}

function validateRequiredStringField(body, fieldName) {
  if (!Object.prototype.hasOwnProperty.call(body, fieldName)) {
    return undefined;
  }
  const value = typeof body[fieldName] === 'string' ? body[fieldName].trim() : '';
  if (!value) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return value;
}

// Returns true if an IP literal is loopback / private / link-local / unique-local
// / unspecified — i.e. an address a company-configured upstream must never point
// at. Used to keep admin-supplied service URLs from reaching internal hosts or
// the cloud metadata endpoint (169.254.169.254). Covers IPv4, IPv6, and
// IPv4-mapped IPv6 (::ffff:a.b.c.d).
function isDisallowedAddress(ip) {
  const v = net.isIP(ip);
  if (v === 4) {
    const o = ip.split('.').map(Number);
    if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    if (o[0] === 0) return true;                                   // 0.0.0.0/8 (unspecified)
    if (o[0] === 10) return true;                                  // 10.0.0.0/8
    if (o[0] === 127) return true;                                 // 127.0.0.0/8 (loopback)
    if (o[0] === 169 && o[1] === 254) return true;                 // 169.254.0.0/16 (link-local + metadata)
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true;     // 172.16.0.0/12
    if (o[0] === 192 && o[1] === 168) return true;                 // 192.168.0.0/16
    if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return true;    // 100.64.0.0/10 (CGNAT)
    if (o[0] === 255 && o[1] === 255 && o[2] === 255 && o[3] === 255) return true; // broadcast
    return false;
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    // IPv4-mapped / -compatible: re-check the embedded IPv4.
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/) || lower.match(/^::(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isDisallowedAddress(mapped[1]);
    if (lower === '::' || lower === '::1') return true;            // unspecified / loopback
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // fe80::/10 link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7 unique-local
    return false;
  }
  // Not a parseable IP — treat as disallowed (caller resolves hostnames first).
  return true;
}

// Validates an admin-supplied upstream URL: must be http(s) AND resolve to a
// public address. Async because it performs DNS resolution. Note: this checks
// at configuration time; a fully rebinding-proof guard would also re-validate
// the resolved IP at fetch time.
async function assertValidHttpUrl(value, fieldName) {
  let parsed;
  try { parsed = new URL(value); } catch {
    throw new Error(`${fieldName} must be a valid URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${fieldName} must use http or https`);
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  let addresses;
  if (net.isIP(hostname)) {
    addresses = [hostname];
  } else {
    try {
      const resolved = await dns.lookup(hostname, { all: true });
      addresses = resolved.map((entry) => entry.address);
    } catch {
      throw new Error(`${fieldName} host could not be resolved`);
    }
  }
  if (!addresses.length || addresses.some(isDisallowedAddress)) {
    throw new Error(`${fieldName} must point to a public host (private/internal addresses are not allowed)`);
  }
}

async function recordAuditEvent(req, action, details = {}, status = 'success') {
  try {
    if (!auditLogsCollection) return;
    const event = {
      action,
      status,
      actorUsername: req?.user?.username || details.actorUsername || null,
      actorRole: req?.user?.role || details.actorRole || null,
      companyId: req?.user?.companyId || details.companyId || null,
      companyName: req?.user?.companyName || details.companyName || null,
      targetType: details.targetType || null,
      targetId: details.targetId || null,
      details,
      ipAddress: req?.ip || null,
      userAgent: req?.headers?.['user-agent'] || null,
      timestamp: new Date()
    };
    await auditLogsCollection.insertOne(event);
  } catch (auditError) {
    console.error('Failed to record audit event:', auditError.message);
  }
}

async function requireCompanyAdmin(req, res, next) {
  try {
    if (!req.user?.companyId || !req.user?.username) {
      return res.status(403).json({ error: 'Company admin access required' });
    }
    const dbUser = await usersCollection.findOne(
      { username: req.user.username, companyId: req.user.companyId },
      { projection: { username: 1, role: 1, active: 1, companyId: 1, companyName: 1 } }
    );
    if (!dbUser) {
      return res.status(403).json({ error: 'User not found in company context' });
    }
    if (dbUser.active === false) {
      return res.status(403).json({ error: 'User account is disabled' });
    }
    if (!['owner', 'admin'].includes(dbUser.role)) {
      return res.status(403).json({ error: 'Admin role required' });
    }
    req.user.role = dbUser.role;
    req.user.companyName = req.user.companyName || dbUser.companyName || null;
    next();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function requireActiveUser(req, res, next) {
  try {
    if (!req.user?.username) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userQuery = req.user.companyId
      ? { username: req.user.username, companyId: req.user.companyId }
      : { username: req.user.username };
    const dbUser = await usersCollection.findOne(userQuery, {
      projection: { password: 0 }
    });

    if (!dbUser) {
      return res.status(403).json({ error: 'User not found' });
    }
    if (dbUser.active === false) {
      return res.status(403).json({ error: 'User account is disabled' });
    }
    if (dbUser.companyId) {
      const company = await getCompanyRecord(dbUser.companyId);
      if (!company) return res.status(403).json({ error: 'Company not found' });
      if (company.active === false) return res.status(403).json({ error: 'Company is disabled' });
      req.user.companyId = dbUser.companyId;
      req.user.companyName = dbUser.companyName || company.name || null;
      req.user.role = dbUser.role || req.user.role || 'member';
    }

    req.dbUser = dbUser;
    next();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

function consumeSimulationToken(feature) {
  return async (req, res, next) => {
    try {
      const userQuery = req.user.companyId
        ? {
            username: req.user.username,
            companyId: req.user.companyId,
            active: { $ne: false },
            simulationTokens: { $gt: 0 }
          }
        : {
            username: req.user.username,
            active: { $ne: false },
            simulationTokens: { $gt: 0 }
          };

      const result = await usersCollection.updateOne(
        userQuery,
        {
          $inc: { simulationTokens: -1 },
          $set: { updatedAt: new Date() }
        }
      );

      if (result.matchedCount === 0) {
        return res.status(403).json({ error: 'No simulation tokens left' });
      }

      await recordAuditEvent(req, 'usage.token.consume', {
        targetType: 'feature',
        targetId: feature,
        feature
      });

      next();
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };
}

function requireAdmetCallbackAuth(req, res, next) {
  const expectedSecret = process.env.ADMET_CALLBACK_SECRET;
  if (!expectedSecret) {
    return res.status(503).json({ error: 'ADMET_CALLBACK_SECRET is not configured' });
  }
  const providedSecret = req.get('x-admet-secret');
  if (providedSecret !== expectedSecret) {
    return res.status(401).json({ error: 'Invalid ADMET callback secret' });
  }
  next();
}

function getPublicAppUrl(req) {
  return (FRONTEND_URL || APP_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

function getPlan(planName) {
  if (typeof planName !== 'string') return null;
  return PLAN_CATALOG[planName.trim()] || null;
}

async function fulfillCheckoutSession(session) {
  if (!billingEventsCollection || !usersCollection) {
    throw new Error('Database collections are not initialized');
  }

  const metadata = session.metadata || {};
  const stripeSessionId = session.id;
  const existingEvent = await billingEventsCollection.findOne({ stripeSessionId });
  if (existingEvent?.status === 'fulfilled') {
    return existingEvent;
  }

  if (session.mode === 'payment' && session.payment_status !== 'paid') {
    await billingEventsCollection.updateOne(
      { stripeSessionId },
      {
        $set: {
          stripeSessionId,
          status: 'ignored_unpaid',
          stripePaymentStatus: session.payment_status,
          updatedAt: new Date()
        },
        $setOnInsert: { createdAt: new Date() }
      },
      { upsert: true }
    );
    return null;
  }

  const credits = Number(metadata.credits || 0);
  const username = metadata.username || null;
  const companyId = metadata.companyId || null;

  if (metadata.purchaseType === 'plan_tokens') {
    if (!username || !Number.isFinite(credits) || credits <= 0) {
      throw new Error('Stripe session is missing username or credits metadata');
    }

    const userFilter = companyId ? { username, companyId } : { username };
    const updateResult = await usersCollection.updateOne(
      userFilter,
      {
        $inc: { simulationTokens: credits },
        $set: {
          lastPlanPurchased: metadata.plan || null,
          lastStripeSessionId: stripeSessionId,
          updatedAt: new Date()
        }
      }
    );

    if (updateResult.matchedCount === 0) {
      throw new Error(`No user found for Stripe fulfillment: ${username}`);
    }
  }

  await billingEventsCollection.updateOne(
    { stripeSessionId },
    {
      $set: {
        stripeSessionId,
        status: 'fulfilled',
        purchaseType: metadata.purchaseType || 'unknown',
        plan: metadata.plan || null,
        username,
        companyId,
        credits,
        amountTotal: session.amount_total || null,
        currency: session.currency || null,
        stripeCustomerId: session.customer || null,
        stripePaymentStatus: session.payment_status || null,
        fulfilledAt: new Date(),
        updatedAt: new Date()
      },
      $setOnInsert: { createdAt: new Date() }
    },
    { upsert: true }
  );

  return { stripeSessionId, username, companyId, credits };
}
/**
 * @swagger
 * /create-checkout-session-onetime:
 *   post:
 *     summary: Create a Stripe checkout session for a one-time payment
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             oneOf:
 *               - type: object
 *                 required: [planName, price]
 *                 properties:
 *                   planName:
 *                     type: string
 *                     description: Legacy field for item name
 *                   price:
 *                     type: number
 *                     description: Legacy field for total amount (USD)
 *               - type: object
 *                 required: [description, totalAmount]
 *                 properties:
 *                   description:
 *                     type: string
 *                     description: Item description/name
 *                   totalAmount:
 *                     type: number
 *                     description: Total amount (USD)
 *           examples:
 *             legacy:
 *               summary: Legacy fields
 *               value:
 *                 planName: Starter
 *                 price: 9.99
 *             new:
 *               summary: New preferred fields
 *               value:
 *                 description: Custom pack
 *                 totalAmount: 12.5
 *     responses:
 *       200:
 *         description: Checkout session created
 */
app.post('/create-checkout-session-onetime', checkoutRateLimit, ensureMongoConnected, authenticateToken, requireActiveUser, async (req, res) => {
  try {
    const { planName, description, totalAmount, cartItems } = req.body;
    const appUrl = getPublicAppUrl(req);
    const plan = getPlan(planName);

    if (plan) {
      if (plan.priceCents <= 0) {
        return res.status(400).json({ error: 'Trial plans do not use Stripe checkout' });
      }

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: `${plan.displayName} token pack`,
                description: `${plan.credits} simulation tokens`
              },
              unit_amount: plan.priceCents
            },
            quantity: 1
          }
        ],
        mode: 'payment',
        success_url: `${appUrl}/dashboard/paidplans?success=true&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appUrl}/dashboard/paidplans?canceled=true`,
        metadata: {
          purchaseType: 'plan_tokens',
          plan: plan.displayName,
          credits: String(plan.credits),
          username: req.user.username,
          userId: req.user.userId || '',
          companyId: req.user.companyId || '',
          companyName: req.user.companyName || ''
        }
      });

      await billingEventsCollection.updateOne(
        { stripeSessionId: session.id },
        {
          $set: {
            stripeSessionId: session.id,
            status: 'pending',
            purchaseType: 'plan_tokens',
            plan: plan.displayName,
            username: req.user.username,
            companyId: req.user.companyId || null,
            credits: plan.credits,
            amountTotal: plan.priceCents,
            currency: 'usd',
            updatedAt: new Date()
          },
          $setOnInsert: { createdAt: new Date() }
        },
        { upsert: true }
      );

      return res.json({ url: session.url, sessionId: session.id });
    }

    const productName = (typeof description === 'string' && description.trim())
      ? description.trim()
      : (Array.isArray(cartItems) && cartItems.length > 0 ? 'Molecule order' : null);

    let amount = totalAmount;
    if (typeof amount === 'string') amount = parseFloat(amount);

    if (!productName || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        error: 'Invalid request body',
        details: 'Provide a known planName or { description, totalAmount } with a positive amount.'
      });
    }
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: productName,
              description: 'One-time purchase',              
            },
            unit_amount: Math.round(amount * 100), // Convert to cents
          },
          quantity: 1,
        },
      ],
      mode: 'payment', // one-time payment
      success_url: `${appUrl}/dashboard/simulation?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/dashboard/simulation?payment=canceled`,
      metadata: {
        purchaseType: 'molecule_order',
        product: productName,
        username: req.user.username,
        userId: req.user.userId || '',
        companyId: req.user.companyId || '',
        companyName: req.user.companyName || ''
      }
    });

    await billingEventsCollection.updateOne(
      { stripeSessionId: session.id },
      {
        $set: {
          stripeSessionId: session.id,
          status: 'pending',
          purchaseType: 'molecule_order',
          username: req.user.username,
          companyId: req.user.companyId || null,
          amountTotal: Math.round(amount * 100),
          currency: 'usd',
          updatedAt: new Date()
        },
        $setOnInsert: { createdAt: new Date() }
      },
      { upsert: true }
    );

    res.json({ url: session.url, sessionId: session.id });
  } catch (error) {
    console.error('Error creating one-time checkout session:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create checkout session endpoint
app.post('/create-checkout-session', checkoutRateLimit, ensureMongoConnected, authenticateToken, requireActiveUser, async (req, res) => {
  try {
    const { planName, isYearly } = req.body;
    const plan = getPlan(planName);
    if (!plan || plan.priceCents <= 0) {
      return res.status(400).json({ error: 'Unknown paid plan' });
    }

    const appUrl = getPublicAppUrl(req);
    
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${plan.displayName} Plan`,
              description: `${plan.displayName} subscription for molecular research tools`,
            },
            unit_amount: plan.priceCents,
            recurring: {
              interval: isYearly ? 'year' : 'month',
            },
          },
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${appUrl}/dashboard/paidplans?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/dashboard/paidplans?canceled=true`,
      metadata: {
        purchaseType: 'plan_tokens',
        plan: plan.displayName,
        credits: String(plan.credits),
        username: req.user.username,
        userId: req.user.userId || '',
        companyId: req.user.companyId || '',
        companyName: req.user.companyName || '',
        billing: isYearly ? 'yearly' : 'monthly',
      }
    });

    await billingEventsCollection.updateOne(
      { stripeSessionId: session.id },
      {
        $set: {
          stripeSessionId: session.id,
          status: 'pending',
          purchaseType: 'plan_tokens',
          plan: plan.displayName,
          username: req.user.username,
          companyId: req.user.companyId || null,
          credits: plan.credits,
          amountTotal: plan.priceCents,
          currency: 'usd',
          updatedAt: new Date()
        },
        $setOnInsert: { createdAt: new Date() }
      },
      { upsert: true }
    );

    res.json({ url: session.url, sessionId: session.id });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get session details endpoint
app.get('/checkout-session/:sessionId', ensureMongoConnected, authenticateToken, requireActiveUser, async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
    if (session.metadata?.username && session.metadata.username !== req.user.username) {
      return res.status(403).json({ error: 'Checkout session does not belong to this user' });
    }
    res.json(session);
  } catch (error) {
    console.error('Error retrieving session:', error);
    res.status(500).json({ error: error.message });
  }
});



/**
 * @swagger
 * /api/signup:
 *   post:
 *     summary: Signup a new user
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *               email:
 *                 type: string
 *               organization:
 *                 type: string
 *                 description: Company name (required) — drives multi-tenant branding
 *               phoneNumber:
 *                 type: string
 *                 description: Optional phone number for contact
 *               shippingAddress:
 *                 type: string
 *                 description: Optional shipping address
 *               billingAddress:
 *                 type: string
 *                 description: Optional billing address
 *     responses:
 *       200:
 *         description: Signup successful
 */
app.post('/api/signup', authRateLimit, ensureMongoConnected, async (req, res) => {
  const { password, phoneNumber, shippingAddress, billingAddress, organization } = req.body;
  // Trim identity fields: stray whitespace from autofill/mobile keyboards
  // otherwise gets stored verbatim and makes signin impossible.
  const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
  const email = typeof req.body.email === 'string' ? req.body.email.trim() : '';
  if (!username || !password || !email || !organization) {
    return res.status(400).json({ error: 'Username, password, email, and company name are required' });
  }

  const normalizedCompanyName = normalizeCompanyName(organization);
  const companySlug = toCompanySlug(normalizedCompanyName);
  if (!normalizedCompanyName || !companySlug) {
    return res.status(400).json({ error: 'A valid company name is required' });
  }

  if (!PASSWORD_POLICY.test(password)) {
    return res.status(400).json({ error: 'Password must be at least 8 characters and include uppercase, lowercase, digit, and special character.' });
  }

  const existing = await usersCollection.findOne({
    $or: [
      { username },
      { email: { $regex: `^${escapeRegExp(email)}$`, $options: 'i' } }
    ]
  });
  if (existing) return res.status(409).json({ error: 'User or email already exists' });

  let company = await companiesCollection.findOne({ slug: companySlug });
  if (!company) {
    const createdCompany = {
      name: normalizedCompanyName,
      slug: companySlug,
      companyId: null,
      ligandServiceConfig: { ...DEFAULT_LIGAND_SERVICE_CONFIG },
      active: true,
      usagePolicy: { ...DEFAULT_USAGE_POLICY },
      monthlyUsage: {
        monthKey: getCurrentMonthKey(),
        simulationsRun: 0,
        updatedAt: new Date()
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const companyInsertResult = await companiesCollection.insertOne(createdCompany);
    company = { ...createdCompany, _id: companyInsertResult.insertedId, companyId: companyInsertResult.insertedId.toString() };
    await companiesCollection.updateOne(
      { _id: companyInsertResult.insertedId },
      { $set: { companyId: company.companyId } }
    );
  } else if (!company.companyId) {
    const normalizedExistingCompanyId = company._id.toString();
    await companiesCollection.updateOne(
      { _id: company._id },
      {
        $set: {
          companyId: normalizedExistingCompanyId,
          usagePolicy: company.usagePolicy || { ...DEFAULT_USAGE_POLICY },
          monthlyUsage: normalizeMonthlyUsage(company.monthlyUsage || {}),
          updatedAt: new Date()
        }
      }
    );
    company = {
      ...company,
      companyId: normalizedExistingCompanyId,
      usagePolicy: normalizeUsagePolicy(company.usagePolicy || {}),
      monthlyUsage: normalizeMonthlyUsage(company.monthlyUsage || {})
    };
  }

  const companyId = company.companyId || company._id.toString();
  const companyUsagePolicy = normalizeUsagePolicy(company.usagePolicy || {});
  const existingCompanyUsers = await usersCollection.countDocuments({ companyId });
  const userRole = existingCompanyUsers === 0 ? 'owner' : 'member';

  const hash = await bcrypt.hash(password, 10);
  // Optional fields cleanup
  const cleanedPhone = typeof phoneNumber === 'string' && phoneNumber.trim() ? phoneNumber.trim() : undefined;
  const cleanedShipping = typeof shippingAddress === 'string' && shippingAddress.trim() ? shippingAddress.trim() : undefined;
  const cleanedBilling = typeof billingAddress === 'string' && billingAddress.trim() ? billingAddress.trim() : undefined;

  const insertDoc = {
    username,
    email,
    password: hash,
    // Non-prod: email verification is disabled, so accounts are active immediately.
    verified: true,
    companyId,
    companyName: company.name,
    role: userRole,
    simulationTokens: companyUsagePolicy.defaultSimulationTokensPerUser,
    active: true,
    createdAt: new Date()
  };

  if (cleanedPhone) insertDoc.phoneNumber = cleanedPhone;
  if (cleanedShipping) insertDoc.shippingAddress = cleanedShipping;
  if (cleanedBilling) insertDoc.billingAddress = cleanedBilling;

  const insertResult = await usersCollection.insertOne(insertDoc);

  // Email verification is disabled (non-prod): accounts are created already
  // verified, so the user is signed in immediately — same token/user shape
  // as /api/signin so the client can log in without a second round trip.
  const tokenPayload = {
    username,
    email,
    userId: insertResult.insertedId.toString(),
    companyId,
    companyName: company.name,
    role: userRole
  };
  const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  res.json({
    message: 'Signup successful.',
    token,
    user: {
      username,
      email,
      companyId,
      companyName: company.name,
      role: userRole,
      simulationTokens: insertDoc.simulationTokens,
      verified: true,
      mustChangePassword: false
    },
    company: { id: companyId, name: company.name },
    role: userRole
  });

  await recordAuditEvent(req, 'company.user.signup', {
    targetType: 'user',
    targetId: username,
    companyId,
    companyName: company.name,
    role: userRole
  });
});

app.get('/api/verify-email', ensureMongoConnected, async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send('Invalid verification link');
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { email, username, companyName } = decoded;
    await usersCollection.updateOne({ email }, { $set: { verified: true } });
    
    // Send success HTML page
    const signInUrl = `${(process.env.FRONTEND_URL || process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')}/auth/sign-in`;
    const brandName = getBrandName(companyName);
    const successHTML = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Email Verified - ${brandName}</title>
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%);
                margin: 0;
                padding: 20px;
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .container {
                background: white;
                padding: 40px;
                border-radius: 12px;
                box-shadow: 0 10px 25px rgba(0,0,0,0.1);
                text-align: center;
                max-width: 500px;
                width: 100%;
            }
            .success-icon {
                width: 64px;
                height: 64px;
                background: #10b981;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                margin: 0 auto 20px;
                color: white;
                font-size: 24px;
            }
            h1 {
                color: #1e3a8a;
                margin-bottom: 10px;
                font-size: 24px;
            }
            p {
                color: #4b5563;
                margin-bottom: 30px;
                line-height: 1.6;
            }
            .login-button {
                background: linear-gradient(135deg, #3b82f6 0%, #1e40af 100%);
                color: white;
                padding: 12px 24px;
                text-decoration: none;
                border-radius: 8px;
                display: inline-block;
                font-weight: 600;
                transition: transform 0.2s;
            }
            .login-button:hover {
                transform: translateY(-1px);
            }
            .logo {
                font-size: 20px;
                font-weight: bold;
                color: #1e3a8a;
                margin-bottom: 20px;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="logo">${brandName.toUpperCase()}</div>
            <div class="success-icon">✓</div>
            <h1>Email Verified Successfully!</h1>
            <p>Welcome to ${brandName}, ${username || 'User'}! Your email has been verified and your account is now active.</p>
            <p>You can now access all features of our molecular research platform.</p>
            <a href="${signInUrl}" class="login-button">Sign In to Your Account</a>
        </div>
    </body>
    </html>`;
    
    res.send(successHTML);
  } catch (err) {
    const errorHTML = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Verification Error - ${getPlatformName()}</title>
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%);
                margin: 0;
                padding: 20px;
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .container {
                background: white;
                padding: 40px;
                border-radius: 12px;
                box-shadow: 0 10px 25px rgba(0,0,0,0.1);
                text-align: center;
                max-width: 500px;
                width: 100%;
            }
            .error-icon {
                width: 64px;
                height: 64px;
                background: #dc2626;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                margin: 0 auto 20px;
                color: white;
                font-size: 24px;
            }
            h1 {
                color: #dc2626;
                margin-bottom: 10px;
                font-size: 24px;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="error-icon">✗</div>
            <h1>Verification Failed</h1>
            <p>The verification link is invalid or has expired. Please request a new verification email.</p>
        </div>
    </body>
    </html>`;
    res.status(400).send(errorHTML);
  }
});

// Resolve a company's branded email palette, failing open to the default.
// Email sends must never break because branding is missing or malformed:
// a null company or a normalizeBrandPalette throw both yield DEFAULT_BRAND_PALETTE.
function resolveCompanyEmailPalette(company) {
  try {
    return normalizeBrandPalette(company?.branding?.palette || {});
  } catch {
    return DEFAULT_BRAND_PALETTE;
  }
}

app.post('/api/password-reset/request', authRateLimit, ensureMongoConnected, async (req, res) => {
  const identifier = typeof req.body.email === 'string' && req.body.email.trim()
    ? req.body.email.trim()
    : (typeof req.body.username === 'string' ? req.body.username.trim() : '');

  if (!identifier) {
    return res.status(400).json({ error: 'Email or username is required' });
  }

  const user = await usersCollection.findOne({
    $or: [{ email: identifier }, { username: identifier }]
  });

  if (user?.email) {
    const resetToken = jwt.sign(
      { reset: true, email: user.email, username: user.username },
      JWT_SECRET,
      { expiresIn: '30m' }
    );
    const resetUrl = `${getPublicAppUrl(req)}/auth/sign-in?resetToken=${encodeURIComponent(resetToken)}`;

    let resetCompany = null;
    try {
      resetCompany = await companiesCollection.findOne({ companyId: user.companyId });
    } catch (companyError) {
      console.warn('Password reset company lookup failed:', companyError.message);
    }
    const resetPalette = resolveCompanyEmailPalette(resetCompany);
    const resetHtml = generatePasswordResetEmailHTML(user.username, resetUrl, {
      palette: resetPalette,
      companyName: user.companyName
    });

    try {
      await sendTitanEmail({
        name: user.username,
        subject: `Reset your ${getBrandName(user.companyName)} password`,
        message: [
          'Use the link below to reset your password. This link expires in 30 minutes.',
          resetUrl,
          'If you did not request this reset, you can ignore this email.'
        ].join('\n\n'),
        recipientEmail: user.email,
        htmlContent: resetHtml
      });
    } catch (error) {
      console.error('Password reset email failed:', error.message);
    }
  }

  res.json({ message: 'If the account exists, a reset email has been sent.' });
});

app.post('/api/password-reset/confirm', authRateLimit, ensureMongoConnected, async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) {
    return res.status(400).json({ error: 'Reset token and new password are required' });
  }
  if (!PASSWORD_POLICY.test(password)) {
    return res.status(400).json({ error: 'Password must be at least 8 characters and include uppercase, lowercase, digit, and special character.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.reset || !decoded.email) {
      return res.status(400).json({ error: 'Invalid reset token' });
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await usersCollection.updateOne(
      { email: decoded.email },
      {
        $set: {
          password: hash,
          mustChangePassword: false,
          passwordChangedAt: new Date(),
          updatedAt: new Date()
        }
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'Password reset successful' });
  } catch (error) {
    res.status(400).json({ error: 'Invalid or expired reset token' });
  }
});

/**
 * @swagger
 * /api/signin:
 *   post:
 *     summary: Signin a user
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Signin successful
 */
app.post('/api/signin', authRateLimit, ensureMongoConnected, async (req, res) => {
  const { password } = req.body;
  // Identifier may be a username or an email; trim it and match email
  // case-insensitively so autofill quirks don't lock users out.
  const identifier = typeof req.body.username === 'string' ? req.body.username.trim() : '';
  if (!identifier || !password) return res.status(400).json({ error: 'Username and password required' });
  // Whitespace-tolerant regexes also match legacy records stored with padding
  // before signup started trimming inputs.
  const idPattern = `^\\s*${escapeRegExp(identifier)}\\s*$`;
  const user = await usersCollection.findOne({
    $or: [
      { username: identifier },
      { username: { $regex: idPattern } },
      { email: { $regex: idPattern, $options: 'i' } }
    ]
  });
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  if (user.active === false) return res.status(403).json({ error: 'User account is disabled' });
  if (user.companyId) {
    const company = await getCompanyRecord(user.companyId);
    if (!company) return res.status(403).json({ error: 'Company not found' });
    if (company.active === false) return res.status(403).json({ error: 'Company is disabled' });
  }
  if (!user.verified) return res.status(403).json({ error: 'Email not verified. Please check your email.' });
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
  const tokenPayload = {
    username: user.username,
    email: user.email,
    userId: user._id.toString(),
    companyId: user.companyId || null,
    companyName: user.companyName || null,
    role: user.role || 'member'
  };
  const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  res.json({
    message: 'Signin successful',
    token,
    user: {
      username: user.username,
      email: user.email,
      companyId: user.companyId || null,
      companyName: user.companyName || null,
      role: user.role || 'member',
      simulationTokens: typeof user.simulationTokens === 'number' ? user.simulationTokens : 0,
      verified: user.verified,
      mustChangePassword: user.mustChangePassword === true
    }
  });

  await recordAuditEvent(req, 'company.user.signin', {
    actorUsername: user.username,
    actorRole: user.role || 'member',
    companyId: user.companyId || null,
    companyName: user.companyName || null,
    targetType: 'user',
    targetId: user.username
  });
});

app.post('/api/change-password', authRateLimit, ensureMongoConnected, authenticateToken, requireActiveUser, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword) {
    return res.status(400).json({ error: 'newPassword is required' });
  }
  if (!PASSWORD_POLICY.test(newPassword)) {
    return res.status(400).json({ error: 'Password must be at least 8 characters and include uppercase, lowercase, digit, and special character.' });
  }

  const userQuery = req.user.companyId
    ? { username: req.user.username, companyId: req.user.companyId }
    : { username: req.user.username };
  const user = await usersCollection.findOne(userQuery);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (user.mustChangePassword !== true) {
    if (!currentPassword) {
      return res.status(400).json({ error: 'currentPassword is required' });
    }
    const currentPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!currentPasswordValid) {
      // 400, not 401: the session is valid; only the submitted currentPassword
      // field is wrong. A 401 here would trip the client's auth interceptor and
      // wrongly log the user out for a typo.
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
  }

  const hash = await bcrypt.hash(newPassword, 10);
  await usersCollection.updateOne(
    userQuery,
    {
      $set: {
        password: hash,
        mustChangePassword: false,
        passwordChangedAt: new Date(),
        updatedAt: new Date()
      }
    }
  );

  await recordAuditEvent(req, 'auth.password.change', {
    targetType: 'user',
    targetId: req.user.username
  });

  res.json({ message: 'Password changed successfully' });
});

app.get('/api/hello', (req, res) => {
  res.send('{"data":"hello"}');
});

// Admin-only debug endpoint to check if a user exists without exposing passwords.
app.get('/api/test-user/:username', ensureMongoConnected, authenticateToken, requireCompanyAdmin, async (req, res) => {
  try {
    const { username } = req.params;
    // Scope the lookup to the admin's own company — this endpoint must not
    // disclose the existence of users in other tenants.
    const user = await usersCollection.findOne(
      { username, companyId: req.user.companyId },
      { projection: { password: 0 } }
    );
    
    if (user) {
      res.json({ 
        exists: true, 
        user: {
          username: user.username,
          email: user.email,
          verified: user.verified
        }
      });
    } else {
      res.json({ exists: false, username });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mol Price API Endpoints
/**
 * @swagger
 * /api/mol-price:
 *   get:
 *     summary: Get molecules with pagination and search
 *     tags: [Mol Price]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Maximum number of molecules to return
 *       - in: query
 *         name: skip
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Number of molecules to skip (for pagination)
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search in ASINEX_ID, IUPAC_NAME, SMILES_STRING, or BRUTTO_FORMULA
 *     responses:
 *       200:
 *         description: List of molecules with pagination info
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 total:
 *                   type: integer
 *                 count:
 *                   type: integer
 *                 limit:
 *                   type: integer
 *                 skip:
 *                   type: integer
 *                 molecules:
 *                   type: array
 *                   items:
 *                     type: object
 *       500:
 *         description: Server error
 */
app.get('/api/mol-price', ensureMongoConnected, async (req, res) => {
  try {
    const { limit = 10, skip = 0, search } = req.query;
    const db = client.db();
    const molPriceCollection = db.collection('mol_price');
    
    let filter = {};
    if (search) {
      const safe = escapeRegExp(String(search));
      filter = {
        $or: [
          { ASINEX_ID: { $regex: safe, $options: 'i' } },
          { IUPAC_NAME: { $regex: safe, $options: 'i' } },
          { SMILES_STRING: { $regex: safe, $options: 'i' } },
           { INCHI: { $regex: safe, $options: 'i' } },
           { INCHIKEY: { $regex: safe, $options: 'i' } },
          { BRUTTO_FORMULA: { $regex: safe, $options: 'i' } }
        ]
      };
    }
    
    const totalCount = await molPriceCollection.countDocuments(filter);
    const molecules = await molPriceCollection
      .find(filter)
      .limit(parseInt(limit))
      .skip(parseInt(skip))
      .toArray();
    
    res.json({
      total: totalCount,
      count: molecules.length,
      limit: parseInt(limit),
      skip: parseInt(skip),
      molecules
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/mol-price/count:
 *   get:
 *     summary: Get total count of molecules
 *     tags: [Mol Price]
 *     responses:
 *       200:
 *         description: Total molecule count
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 count:
 *                   type: integer
 *       500:
 *         description: Server error
 */
app.get('/api/mol-price/count', ensureMongoConnected, async (req, res) => {
  try {
    const db = client.db();
    const molPriceCollection = db.collection('mol_price');
    const count = await molPriceCollection.countDocuments();
    res.json({ count });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/mol-price/search:
 *   get:
 *     summary: Advanced search for molecules
 *     tags: [Mol Price]
 *     parameters:
 *       - in: query
 *         name: query
 *         schema:
 *           type: string
 *         description: Search across ASINEX_ID, IUPAC_NAME, SMILES_STRING, BRUTTO_FORMULA
 *       - in: query
 *         name: smiles
 *         schema:
 *           type: string
 *         description: Search within SMILES strings only
 *       - in: query
 *         name: formula
 *         schema:
 *           type: string
 *         description: Search within molecular formulas only
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Maximum number of results
 *       - in: query
 *         name: skip
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Number of results to skip
 *     responses:
 *       200:
 *         description: Search results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 query:
 *                   type: object
 *                 total:
 *                   type: integer
 *                 count:
 *                   type: integer
 *                 molecules:
 *                   type: array
 *                   items:
 *                     type: object
 *       500:
 *         description: Server error
 */
app.get('/api/mol-price/search', ensureMongoConnected, async (req, res) => {
  try {
    const { query, smiles, formula, limit = 10, skip = 0 } = req.query;
    const db = client.db();
    const molPriceCollection = db.collection('mol_price');
    
    let filter = {};
    if (query) {
      const safe = escapeRegExp(String(query));
      filter = {
        $or: [
          { ASINEX_ID: { $regex: safe, $options: 'i' } },
          { IUPAC_NAME: { $regex: safe, $options: 'i' } },
          { INCHI: { $regex: safe, $options: 'i' } },
          { INCHIKEY: { $regex: safe, $options: 'i' } },
          { SMILES_STRING: { $regex: safe, $options: 'i' } },
          { ASINEX_ID: query },
          { IUPAC_NAME:  query },
          { INCHI:   query  },
          { INCHIKEY:  query },
          { SMILES_STRING:  query },
         // { BRUTTO_FORMULA: { $regex: query, $options: 'i' } }
        ]
      };
    }
    if (smiles) {
      filter.SMILES_STRING = smiles; // value only, not an object
    }
    if (formula) {
      filter.BRUTTO_FORMULA = { $regex: escapeRegExp(String(formula)), $options: 'i' };
    }
    
    const totalCount = await molPriceCollection.countDocuments(filter);
    const molecules = await molPriceCollection
      .find(filter)
      .limit(parseInt(limit))
      .skip(parseInt(skip))
      .toArray();
    
    res.json({
      query: { query, smiles, formula },
      total: totalCount,
      count: molecules.length,
      molecules
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/mol-price/{id}:
 *   get:
 *     summary: Get specific molecule by ASINEX_ID
 *     tags: [Mol Price]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ASINEX_ID of the molecule (URL encode spaces as %20)
 *     responses:
 *       200:
 *         description: Molecule details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 _id:
 *                   type: string
 *                 ASINEX_ID:
 *                   type: string
 *                 IUPAC_NAME:
 *                   type: string
 *                 SMILES_STRING:
 *                   type: string
 *                 BRUTTO_FORMULA:
 *                   type: string
 *                 MW_STRUCTURE:
 *                   type: number
 *                 AVAILABLE_MG:
 *                   type: integer
 *                 PRICE_1MG:
 *                   type: number
 *                 PRICE_2MG:
 *                   type: number
 *                 PRICE_5MG:
 *                   type: number
 *                 PRICE_10MG:
 *                   type: number
 *       404:
 *         description: Molecule not found
 *       500:
 *         description: Server error
 */
app.get('/api/mol-price/:id', ensureMongoConnected, async (req, res) => {
  try {
    const { id } = req.params;
    const db = client.db();
    const molPriceCollection = db.collection('mol_price');
    
    const molecule = await molPriceCollection.findOne({ 
      ASINEX_ID: decodeURIComponent(id) 
    });
    
    if (!molecule) {
      return res.status(404).json({ error: 'Molecule not found' });
    }
    
    res.json(molecule);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/mol-price-stats:
 *   get:
 *     summary: Get collection statistics
 *     tags: [Mol Price]
 *     responses:
 *       200:
 *         description: Statistical information about the molecule collection
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalMolecules:
 *                   type: integer
 *                   description: Total number of molecules
 *                 avgPrice1mg:
 *                   type: number
 *                   description: Average price for 1mg
 *                 maxPrice1mg:
 *                   type: number
 *                   description: Maximum price for 1mg
 *                 minPrice1mg:
 *                   type: number
 *                   description: Minimum price for 1mg
 *                 avgMolecularWeight:
 *                   type: number
 *                   description: Average molecular weight
 *                 maxMolecularWeight:
 *                   type: number
 *                   description: Maximum molecular weight
 *                 minMolecularWeight:
 *                   type: number
 *                   description: Minimum molecular weight
 *                 totalAvailableMg:
 *                   type: number
 *                   description: Total available stock in milligrams
 *       500:
 *         description: Server error
 */
app.get('/api/mol-price-stats', ensureMongoConnected, async (req, res) => {
  try {
    const db = client.db();
    const molPriceCollection = db.collection('mol_price');
    
    const stats = await molPriceCollection.aggregate([
      {
        $group: {
          _id: null,
          totalMolecules: { $sum: 1 },
          avgPrice1mg: { $avg: '$PRICE_1MG' },
          maxPrice1mg: { $max: '$PRICE_1MG' },
          minPrice1mg: { $min: '$PRICE_1MG' },
          avgMolecularWeight: { $avg: '$MW_STRUCTURE' },
          maxMolecularWeight: { $max: '$MW_STRUCTURE' },
          minMolecularWeight: { $min: '$MW_STRUCTURE' },
          totalAvailableMg: { $sum: '$AVAILABLE_MG' }
        }
      }
    ]).toArray();
    
    res.json(stats[0] || {});
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Map an upstream proxy response status for relaying to the client. These routes
// already ran authenticateToken, so a 401 from the upstream means the SERVER's
// credentials to that service failed — surface it as 502 (Bad Gateway) rather
// than forwarding 401, which would trip the client's auth interceptor and log
// the authenticated user out for an upstream problem.
function relayUpstreamStatus(status) {
  return status === 401 ? 502 : status;
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    // 401 (not 403): the token is missing/expired/invalid, so the client should
    // re-authenticate. Authorization failures (wrong role, disabled account, no
    // tokens left) deliberately stay 403 — the client must NOT log out on those.
    if (err) return res.status(401).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
}

app.post('/api/shop', ensureMongoConnected, authenticateToken, requireActiveUser, async (req, res) => {
  try {
    const { stockApiUrl } = await getRequestLigandServiceConfig(req);
    const response = await fetch(stockApiUrl, {
      method: 'POST',
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});



app.get('/api/simulation', ensureMongoConnected, authenticateToken, requireActiveUser, async (req, res) => {
  const { pdbid, smiles } = req.query;
  if (!pdbid || !smiles) {
    return res.status(400).json({ error: 'pdbid and smiles are required as query parameters' });
  }
  try {
    const simulationLogs = client.db().collection('simulation_logs');
    const tenantFilter = buildTenantFilter(req.user);
    const company = req.user.companyId ? await getCompanyRecord(req.user.companyId) : null;

    if (req.user.companyId && !company) {
      return res.status(403).json({ error: 'Company not found' });
    }
    if (company && company.active === false) {
      return res.status(403).json({ error: 'Company is disabled' });
    }

    const usagePolicy = company ? normalizeUsagePolicy(company.usagePolicy || {}) : { ...DEFAULT_USAGE_POLICY };
    const monthlyUsage = company ? normalizeMonthlyUsage(company.monthlyUsage || {}) : null;
    if (
      company &&
      usagePolicy.monthlySimulationCap !== null &&
      monthlyUsage.simulationsRun >= usagePolicy.monthlySimulationCap
    ) {
      return res.status(403).json({
        error: 'Monthly simulation cap reached for your company',
        usage: monthlyUsage.simulationsRun,
        monthlySimulationCap: usagePolicy.monthlySimulationCap
      });
    }

    // Check if simulation already exists for this user, pdbid, and smiles
    const existing = await simulationLogs.findOne({
      ...tenantFilter,
      pdbid,
      smiles
    });
    if (existing) {
      await recordAuditEvent(req, 'simulation.cache_hit', {
        targetType: 'simulation',
        targetId: existing.simulationKey,
        pdbid,
        smiles,
        mode: 'GET'
      });
      return res.json({ ...existing.result, simulationKey: existing.simulationKey });
    }
    // Check and subtract simulationTokens
    const userQuery = req.user.companyId
      ? { username: req.user.username, companyId: req.user.companyId }
      : { username: req.user.username };
    const userDoc = await usersCollection.findOne(userQuery);
    if (userDoc?.active === false) {
      return res.status(403).json({ error: 'User account is disabled' });
    }
    if (!userDoc || typeof userDoc.simulationTokens !== 'number' || userDoc.simulationTokens <= 0) {
      return res.status(403).json({ error: 'No simulation tokens left' });
    }
    await usersCollection.updateOne(
      userQuery,
      { $inc: { simulationTokens: -1 } }
    );
    // Generate a 12-character random key
    const simulationKey = Array.from({length: 12}, () =>
      Math.random().toString(36).charAt(2)
    ).join('');
    // Call external API
    const { dockingApiUrl } = await getRequestLigandServiceConfig(req);
    const url = `${dockingApiUrl}/${encodeURIComponent(pdbid)}&${encodeURIComponent(smiles)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/json'
      }
    });
    const data = await response.json();
    // Record invocation in MongoDB, including the result and simulationKey
    await simulationLogs.insertOne({
      username: req.user.username,
      companyId: req.user.companyId || null,
      companyName: req.user.companyName || null,
      pdbid,
      smiles,
      result: data,
      simulationKey,
      timestamp: new Date()
    });

    if (req.user.companyId) {
      await incrementCompanyMonthlyUsage(req.user.companyId);
    }

    await recordAuditEvent(req, 'simulation.run', {
      targetType: 'simulation',
      targetId: simulationKey,
      pdbid,
      smiles,
      mode: 'GET'
    });

    res.json({ ...data, simulationKey });
  } catch (error) {
    await recordAuditEvent(req, 'simulation.run', {
      targetType: 'simulation',
      targetId: `${pdbid || ''}:${smiles || ''}`,
      mode: 'GET',
      error: error.message
    }, 'error');
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/simulation:
 *   post:
 *     summary: Run simulation with POST method (requires JWT)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               pdbid:
 *                 type: string
 *                 description: Protein Data Bank ID
 *               smiles:
 *                 type: string
 *                 description: SMILES string for the molecule
 *             required:
 *               - pdbid
 *               - smiles
 *     responses:
 *       200:
 *         description: Simulation result
 *       400:
 *         description: Missing required parameters
 *       403:
 *         description: No simulation tokens left
 *       500:
 *         description: Server error
 */
app.post('/api/simulation', ensureMongoConnected, authenticateToken, requireActiveUser, async (req, res) => {
  const { pdbid, smiles } = req.body;
  if (!pdbid || !smiles) {
    return res.status(400).json({ error: 'pdbid and smiles are required in request body' });
  }
  try {
    const simulationLogs = client.db().collection('simulation_logs');
    const tenantFilter = buildTenantFilter(req.user);
    const company = req.user.companyId ? await getCompanyRecord(req.user.companyId) : null;

    if (req.user.companyId && !company) {
      return res.status(403).json({ error: 'Company not found' });
    }
    if (company && company.active === false) {
      return res.status(403).json({ error: 'Company is disabled' });
    }

    const usagePolicy = company ? normalizeUsagePolicy(company.usagePolicy || {}) : { ...DEFAULT_USAGE_POLICY };
    const monthlyUsage = company ? normalizeMonthlyUsage(company.monthlyUsage || {}) : null;
    if (
      company &&
      usagePolicy.monthlySimulationCap !== null &&
      monthlyUsage.simulationsRun >= usagePolicy.monthlySimulationCap
    ) {
      return res.status(403).json({
        error: 'Monthly simulation cap reached for your company',
        usage: monthlyUsage.simulationsRun,
        monthlySimulationCap: usagePolicy.monthlySimulationCap
      });
    }

    // Check if simulation already exists for this user, pdbid, and smiles
    const existing = await simulationLogs.findOne({
      ...tenantFilter,
      pdbid,
      smiles
    });
    if (existing) {
      await recordAuditEvent(req, 'simulation.cache_hit', {
        targetType: 'simulation',
        targetId: existing.simulationKey,
        pdbid,
        smiles,
        mode: 'POST'
      });
      return res.json({ ...existing.result, simulationKey: existing.simulationKey });
    }
    // Check and subtract simulationTokens
    const userQuery = req.user.companyId
      ? { username: req.user.username, companyId: req.user.companyId }
      : { username: req.user.username };
    const userDoc = await usersCollection.findOne(userQuery);
    if (userDoc?.active === false) {
      return res.status(403).json({ error: 'User account is disabled' });
    }
    if (!userDoc || typeof userDoc.simulationTokens !== 'number' || userDoc.simulationTokens <= 0) {
      return res.status(403).json({ error: 'No simulation tokens left' });
    }
    await usersCollection.updateOne(
      userQuery,
      { $inc: { simulationTokens: -1 } }
    );
    // Generate a 12-character random key
    const simulationKey = Array.from({length: 12}, () =>
      Math.random().toString(36).charAt(2)
    ).join('');
    // Call external API with POST method
    const { dockingApiUrl } = await getRequestLigandServiceConfig(req);
    const response = await fetch(dockingApiUrl, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        pdbID: pdbid,
        smiles: smiles === decodeURIComponent(smiles) ? encodeURIComponent(smiles) : smiles
      })
    });
    const data = await response.json();
    // Record invocation in MongoDB, including the result and simulationKey
    await simulationLogs.insertOne({
      username: req.user.username,
      companyId: req.user.companyId || null,
      companyName: req.user.companyName || null,
      pdbid,
      smiles,
      result: data,
      simulationKey,
      timestamp: new Date(),
      method: 'POST'
    });

    if (req.user.companyId) {
      await incrementCompanyMonthlyUsage(req.user.companyId);
    }

    await recordAuditEvent(req, 'simulation.run', {
      targetType: 'simulation',
      targetId: simulationKey,
      pdbid,
      smiles,
      mode: 'POST'
    });

    res.json({ ...data, simulationKey });
  } catch (error) {
    await recordAuditEvent(req, 'simulation.run', {
      targetType: 'simulation',
      targetId: `${pdbid || ''}:${smiles || ''}`,
      mode: 'POST',
      error: error.message
    }, 'error');
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/simulation-logs', ensureMongoConnected, authenticateToken, requireActiveUser, async (req, res) => {
  try {
    const simulationLogs = client.db().collection('simulation_logs');
    const tenantFilter = buildTenantFilter(req.user);
    const logs = await simulationLogs.find(tenantFilter).sort({ timestamp: -1 }).toArray();
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/sanitizedpdb/:simulationKey', ensureMongoConnected, authenticateToken, requireActiveUser, async (req, res) => {
  const { simulationKey } = req.params;
  try {
    const simulationLogs = client.db().collection('simulation_logs');
    const tenantFilter = buildTenantFilter(req.user);
    // Find simulation by simulationKey
    const existing = await simulationLogs.findOne({ simulationKey, ...tenantFilter });
    if (existing && existing.result && existing.result.pdb) {
      // Replace \n with CRLF
      const pdbCRLF = existing.result.pdb.replace(/\n/g, '\r\n');
      res.setHeader('Content-Disposition', `attachment; filename="${existing.simulationKey || 'simulation'}.pdb"`);
      res.setHeader('Content-Type', 'chemical/x-pdb');
      return res.send(pdbCRLF);
    }
    res.status(404).json({ error: 'Simulation result not found' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


/**
 * @swagger
 * /api/sanitizedsdf/{simulationKey}:
 *   get:
 *     summary: Download sanitized SDF file for a simulation
 *     tags: [Simulations]
 *     parameters:
 *       - in: path
 *         name: simulationKey
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Sanitized SDF file
 *         content:
 *           chemical/x-sdf:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Simulation result not found
 *       500:
 *         description: Server error
 */
app.get('/api/sanitizedsdf/:simulationKey', ensureMongoConnected, authenticateToken, requireActiveUser, async (req, res) => {
  const { simulationKey } = req.params;
  try {
    const simulationLogs = client.db().collection('simulation_logs');
    const tenantFilter = buildTenantFilter(req.user);
    // Find simulation by simulationKey
    const existing = await simulationLogs.findOne({ simulationKey, ...tenantFilter });
    if (existing && existing.result && existing.result.sdf) {
      // Replace \n with CRLF
      const sdfCRLF = existing.result.sdf.replace(/\n/g, '\r\n');
      res.setHeader('Content-Disposition', `attachment; filename="${existing.simulationKey || 'simulation'}.sdf"`);
      res.setHeader('Content-Type', 'chemical/x-sdf');
      return res.send(sdfCRLF);
    }
    res.status(404).json({ error: 'Simulation result not found' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


/**
 * @swagger
 * /api/sanitizedminimalsdf/{simulationKey}:
 *   get:
 *     summary: Download sanitized minimal SDF file (unique SMILES, minimal score)
 *     tags: [Simulations]
 *     parameters:
 *       - in: path
 *         name: simulationKey
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Sanitized minimal SDF file
 *         content:
 *           chemical/x-sdf:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Simulation result not found
 *       500:
 *         description: Server error
 */
app.get('/api/sanitizedminimalsdf/:simulationKey', ensureMongoConnected, authenticateToken, requireActiveUser, async (req, res) => {
 const { simulationKey } = req.params;
  try {
    const simulationLogs = client.db().collection('simulation_logs');
    const tenantFilter = buildTenantFilter(req.user);
    // Find simulation by simulationKey
    const existing = await simulationLogs.findOne({ simulationKey, ...tenantFilter });
    if (existing && existing.result && existing.result.sdf) {
      // Split SDF by $$$$ delimiter
      const sdfBlocks = existing.result.sdf.split('$$$$');
      // Parse blocks to extract SMILES and score
      const smilesMap = {};
      sdfBlocks.forEach(block => {
        const lines = block.split('\n');
        let smiles = null;
        let score = null;
        lines.forEach(line => {
          if (line.startsWith('>  <smiles>')) {
            smiles = lines[lines.indexOf(line) + 1]?.trim();
          }
          if (line.startsWith('>  <SCORE>')) {
            score = parseFloat(lines[lines.indexOf(line) + 1]?.trim());
          }
        });
        if (smiles) {
          if (!(smiles in smilesMap) || (score !== null && score < smilesMap[smiles].score)) {
            smilesMap[smiles] = { block, score };
          }
        }
      });
      // Rebuild SDF with unique SMILES and minimal score
      const reducedSDF = Object.values(smilesMap).map(obj => obj.block.trim()).join('\n$$$$\n') + '\n$$$$\n';
      // Replace \n with CRLF
      const sdfCRLF = reducedSDF.replace(/\n/g, '\r\n');
      res.setHeader('Content-Disposition', `attachment; filename="${existing.simulationKey || 'simulation'}.sdf"`);
      res.setHeader('Content-Type', 'chemical/x-sdf');
      return res.send(sdfCRLF);
    }
    res.status(404).json({ error: 'Simulation result not found' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/sanitizedspecificsdf/{simulationKey}/{smiles}:
 *   get:
 *     summary: Download SDF block for a specific SMILES from a simulation
 *     tags: [Simulations]
 *     parameters:
 *       - in: path
 *         name: simulationKey
 *         required: true
 *         schema:
 *           type: string
 *         description: Simulation key
 *       - in: path
 *         name: smiles
 *         required: true
 *         schema:
 *           type: string
 *         description: SMILES string to filter for
 *     responses:
 *       200:
 *         description: SDF block for the requested SMILES
 *         content:
 *           chemical/x-sdf:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Simulation result or SMILES not found
 *       500:
 *         description: Server error
 */
app.get('/api/sanitizedspecificsdf/:simulationKey/:smiles', ensureMongoConnected, authenticateToken, requireActiveUser, async (req, res) => {
 const { simulationKey, smiles } = req.params;
  try {
    const simulationLogs = client.db().collection('simulation_logs');
    const tenantFilter = buildTenantFilter(req.user);
    // Find simulation by simulationKey
    const existing = await simulationLogs.findOne({ simulationKey, ...tenantFilter });
    if (existing && existing.result && existing.result.sdf) {
      // Split SDF by $$$$ delimiter
      const sdfBlocks = existing.result.sdf.split('$$$$');
      // Find the block for the specific SMILES (case-insensitive, trim)
      let foundBlock = null;
      for (const block of sdfBlocks) {
        const lines = block.split('\n');
        for (let i = 0; i < lines.length; i++) {
          // Try both <SMILES_STRING> and <smiles> for compatibility
          if (lines[i].toLowerCase().startsWith('>  <smiles_string>') || lines[i].toLowerCase().startsWith('>  <smiles>')) {
            const blockSmiles = lines[i+1]?.trim();
            if (blockSmiles && blockSmiles.toLowerCase() === smiles.trim().toLowerCase()) {
              foundBlock = block.trim();
              break;
            }
          }
        }
        if (foundBlock) break;
      }
      if (foundBlock) {
        // Replace \n with CRLF
        const sdfCRLF = foundBlock.replace(/\n/g, '\r\n') + '\r\n$$$$\r\n';
        res.setHeader('Content-Disposition', `attachment; filename="${existing.simulationKey || 'simulation'}_${smiles}.sdf"`);
        res.setHeader('Content-Type', 'chemical/x-sdf');
        return res.send(sdfCRLF);
      } else {
        return res.status(404).json({ error: 'SMILES not found in SDF' });
      }
    }
    res.status(404).json({ error: 'Simulation result not found' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});



// Add this to your Express server setup
app.post('/api/validate-token', ensureMongoConnected, async (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.json({ valid: false, error: 'No token provided' });
  jwt.verify(token, JWT_SECRET, async (err, decoded) => {
    if (err || !decoded || !decoded.username) return res.json({ valid: false, error: 'Invalid token' });
    const userQuery = decoded.companyId
      ? { username: decoded.username, companyId: decoded.companyId }
      : { username: decoded.username };
    const user = await usersCollection.findOne(userQuery, { projection: { password: 0 } });
    if (!user) return res.json({ valid: false, error: 'User not found' });
    if (user.active === false) return res.json({ valid: false, error: 'User account is disabled' });
    if (decoded.companyId && user.companyId && decoded.companyId !== user.companyId) {
      return res.json({ valid: false, error: 'Tenant mismatch' });
    }
    if (user.companyId) {
      const company = await getCompanyRecord(user.companyId);
      if (!company) return res.json({ valid: false, error: 'Company not found' });
      if (company.active === false) return res.json({ valid: false, error: 'Company is disabled' });
    }
    res.json({
      valid: true,
      user: {
        ...user,
        role: user.role || 'member',
        companyId: user.companyId || null,
        companyName: user.companyName || null,
        active: user.active !== false
      }
    });
  });
});

app.get('/api/company/branding', ensureMongoConnected, authenticateToken, requireActiveUser, async (req, res) => {
  try {
    const company = await getCompanyRecord(req.user.companyId);
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }
    res.json({ branding: serializeCompanyBranding(company) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/company/branding/extract', ensureMongoConnected, authenticateToken, requireCompanyAdmin, async (req, res) => {
  try {
    const company = await getCompanyRecord(req.user.companyId);
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }
    if (company.active === false) {
      return res.status(403).json({ error: 'Company is disabled' });
    }

    try {
      const normalizedLogo = await parseAndNormalizeLogoUpload(req.body?.logoUpload);
      const palette = await extractBrandPalette(normalizedLogo.data);
      return res.json({ palette });
    } catch (validationError) {
      return res.status(400).json({ error: validationError.message });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/company/branding', ensureMongoConnected, authenticateToken, requireCompanyAdmin, async (req, res) => {
  try {
    const company = await getCompanyRecord(req.user.companyId);
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }
    if (company.active === false) {
      return res.status(403).json({ error: 'Company is disabled' });
    }

    const paletteFields = ['primary', 'accent', 'light', 'dark'];
    if (
      !req.body?.palette
      || paletteFields.some((field) => !Object.prototype.hasOwnProperty.call(req.body.palette, field))
    ) {
      return res.status(400).json({ error: 'A complete primary, accent, light, and dark palette is required' });
    }

    let palette;
    let normalizedLogo = null;
    try {
      palette = normalizeBrandPalette(req.body.palette);
      if (Object.prototype.hasOwnProperty.call(req.body, 'logoUpload')) {
        normalizedLogo = await parseAndNormalizeLogoUpload(req.body.logoUpload);
      }
    } catch (validationError) {
      return res.status(400).json({ error: validationError.message });
    }

    const updatedAt = new Date();
    const branding = { palette, updatedAt };
    const logo = normalizedLogo || company.branding?.logo || null;
    if (logo) {
      branding.logo = logo;
    }

    await companiesCollection.updateOne(
      { companyId: req.user.companyId },
      { $set: { branding, updatedAt } }
    );

    await recordAuditEvent(req, 'company.branding.update', {
      targetType: 'company',
      targetId: req.user.companyId,
      updatedFields: normalizedLogo ? ['palette', 'logo'] : ['palette'],
      logoFileName: normalizedLogo?.fileName || null,
      logoSizeBytes: normalizedLogo?.sizeBytes || null
    });

    res.json({
      message: 'Branding saved',
      branding: serializeCompanyBranding({ branding })
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/company/usage', ensureMongoConnected, authenticateToken, requireCompanyAdmin, async (req, res) => {
  try {
    if (!req.user.companyId) {
      return res.status(400).json({ error: 'Company context is required' });
    }

    const company = await getCompanyRecord(req.user.companyId);
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const members = await usersCollection.find(
      { companyId: req.user.companyId },
      {
        projection: {
          username: 1,
          email: 1,
          role: 1,
          active: 1,
          simulationTokens: 1,
          createdAt: 1
        }
      }
    ).sort({ createdAt: 1 }).toArray();

    const usagePolicy = normalizeUsagePolicy(company.usagePolicy || {});
    const monthlyUsage = normalizeMonthlyUsage(company.monthlyUsage || {});
    const activeMembers = members.filter((member) => member.active !== false);
    const totalTokensRemaining = activeMembers.reduce(
      (sum, member) => sum + (Number.isFinite(member.simulationTokens) ? member.simulationTokens : 0),
      0
    );

    const monthlySimulationCap = usagePolicy.monthlySimulationCap;
    const monthlyUsagePercent = monthlySimulationCap
      ? Math.min(100, Math.round((monthlyUsage.simulationsRun / monthlySimulationCap) * 100))
      : null;

    res.json({
      company: {
        id: company.companyId,
        name: company.name,
        active: company.active !== false,
        ligandServiceConfig: normalizeLigandServiceConfig(company.ligandServiceConfig || {}),
        ligandUpload: company.ligandUpload
          ? {
              fileName: company.ligandUpload.fileName,
              contentType: company.ligandUpload.contentType,
              sizeBytes: company.ligandUpload.sizeBytes,
              uploadedAt: company.ligandUpload.uploadedAt
            }
          : null
      },
      usagePolicy,
      usage: {
        monthKey: monthlyUsage.monthKey,
        simulationsRun: monthlyUsage.simulationsRun,
        monthlySimulationCap,
        monthlyUsagePercent,
        monthlyRemaining: monthlySimulationCap !== null
          ? Math.max(0, monthlySimulationCap - monthlyUsage.simulationsRun)
          : null,
        activeMembers: activeMembers.length,
        totalMembers: members.length,
        disabledMembers: members.filter((member) => member.active === false).length,
        totalTokensRemaining
      },
      members
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/company/usage-policy', ensureMongoConnected, authenticateToken, requireCompanyAdmin, async (req, res) => {
  try {
    const company = await getCompanyRecord(req.user.companyId);
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const currentPolicy = normalizeUsagePolicy(company.usagePolicy || {});
    const updates = {};

    if (Object.prototype.hasOwnProperty.call(req.body, 'monthlySimulationCap')) {
      const capRaw = req.body.monthlySimulationCap;
      if (capRaw === null || capRaw === '' || capRaw === undefined) {
        updates.monthlySimulationCap = null;
      } else if (!Number.isFinite(Number(capRaw)) || Number(capRaw) <= 0) {
        return res.status(400).json({ error: 'monthlySimulationCap must be a positive number or null' });
      } else {
        updates.monthlySimulationCap = Math.floor(Number(capRaw));
      }
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'defaultSimulationTokensPerUser')) {
      const defaultTokensRaw = req.body.defaultSimulationTokensPerUser;
      if (!Number.isFinite(Number(defaultTokensRaw)) || Number(defaultTokensRaw) < 0) {
        return res.status(400).json({ error: 'defaultSimulationTokensPerUser must be 0 or a positive number' });
      }
      updates.defaultSimulationTokensPerUser = Math.floor(Number(defaultTokensRaw));
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No usage policy fields provided' });
    }

    const nextPolicy = {
      ...currentPolicy,
      ...updates
    };

    await companiesCollection.updateOne(
      { companyId: req.user.companyId },
      { $set: { usagePolicy: nextPolicy, updatedAt: new Date() } }
    );

    if (req.body.applyDefaultTokensToAllMembers === true && updates.defaultSimulationTokensPerUser !== undefined) {
      await usersCollection.updateMany(
        { companyId: req.user.companyId, active: { $ne: false } },
        { $set: { simulationTokens: nextPolicy.defaultSimulationTokensPerUser } }
      );
    }

    await recordAuditEvent(req, 'company.usage_policy.update', {
      targetType: 'company',
      targetId: req.user.companyId,
      updates: nextPolicy,
      applyDefaultTokensToAllMembers: req.body.applyDefaultTokensToAllMembers === true
    });

    res.json({
      message: 'Usage policy updated',
      usagePolicy: nextPolicy
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/company/ligand-upload', ensureMongoConnected, authenticateToken, requireCompanyAdmin, async (req, res) => {
  try {
    const company = await getCompanyRecord(req.user.companyId);
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    let normalizedLigandUpload;
    try {
      normalizedLigandUpload = parseLigandUpload(req.body?.ligandUpload, { required: true });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    await companiesCollection.updateOne(
      { companyId: req.user.companyId },
      { $set: { ligandUpload: normalizedLigandUpload, updatedAt: new Date() } }
    );

    await recordAuditEvent(req, 'company.ligand_upload.update', {
      targetType: 'company',
      targetId: req.user.companyId,
      fileName: normalizedLigandUpload.fileName,
      sizeBytes: normalizedLigandUpload.sizeBytes
    });

    res.json({
      message: 'Ligand file uploaded',
      ligandUpload: {
        fileName: normalizedLigandUpload.fileName,
        contentType: normalizedLigandUpload.contentType,
        sizeBytes: normalizedLigandUpload.sizeBytes,
        uploadedAt: normalizedLigandUpload.uploadedAt
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/company/ligand-service-config', ensureMongoConnected, authenticateToken, requireCompanyAdmin, async (req, res) => {
  try {
    const company = await getCompanyRecord(req.user.companyId);
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const currentConfig = normalizeLigandServiceConfig(company.ligandServiceConfig || {});
    const updates = {};
    try {
      for (const fieldName of ['catalogApiBase', 'stockApiUrl', 'dockingApiUrl', 'diffdockApiUrl']) {
        const value = validateRequiredStringField(req.body || {}, fieldName);
        if (value !== undefined) {
          await assertValidHttpUrl(value, fieldName);
          updates[fieldName] = value;
        }
      }
    } catch (validationError) {
      return res.status(400).json({ error: validationError.message });
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No ligand service config fields provided' });
    }

    const ligandServiceConfig = normalizeLigandServiceConfig({ ...currentConfig, ...updates });
    await companiesCollection.updateOne(
      { companyId: req.user.companyId },
      { $set: { ligandServiceConfig, updatedAt: new Date() } }
    );

    await recordAuditEvent(req, 'company.ligand_service_config.update', {
      targetType: 'company',
      targetId: req.user.companyId,
      updates: ligandServiceConfig
    });

    res.json({
      message: 'Ligand service config updated',
      ligandServiceConfig
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/company/members', ensureMongoConnected, authenticateToken, requireCompanyAdmin, async (req, res) => {
  try {
    const members = await usersCollection.find(
      { companyId: req.user.companyId },
      { projection: { password: 0 } }
    ).sort({ createdAt: 1 }).toArray();
    res.json({ members });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/company/members', ensureMongoConnected, authenticateToken, requireCompanyAdmin, async (req, res) => {
  try {
    const { username, email, role = 'member', password } = req.body;
    if (!username || !email) {
      return res.status(400).json({ error: 'username and email are required' });
    }

    if (!['member', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'role must be either member or admin' });
    }

    const existing = await usersCollection.findOne({ $or: [{ username }, { email }] });
    if (existing) {
      return res.status(409).json({ error: 'User with this username or email already exists' });
    }

    const company = await getCompanyRecord(req.user.companyId);
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }
    if (company.active === false) {
      return res.status(403).json({ error: 'Company is disabled' });
    }

    const generatedPassword = password || generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(generatedPassword, 10);
    const usagePolicy = normalizeUsagePolicy(company.usagePolicy || {});
    const createdAt = new Date();

    const newMember = {
      username,
      email,
      password: passwordHash,
      verified: true,
      mustChangePassword: !password,
      role,
      active: true,
      companyId: req.user.companyId,
      companyName: company.name,
      simulationTokens: usagePolicy.defaultSimulationTokensPerUser,
      createdAt
    };

    await usersCollection.insertOne(newMember);

    await recordAuditEvent(req, 'company.member.create', {
      targetType: 'user',
      targetId: username,
      role,
      mustChangePassword: !password
    });

    let inviteEmailSent = false;
    try {
      const signInUrl = `${(process.env.FRONTEND_URL || process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')}/auth/sign-in`;
      const passwordLine = password
        ? 'Use the initial password shared by your company admin.'
        : `Temporary password: ${generatedPassword}`;
      const invitePalette = resolveCompanyEmailPalette(company);
      const inviteHtml = generateInviteEmailHTML({
        invitee: username,
        inviter: req.user.username,
        companyName: company.name,
        role,
        passwordLine,
        signInUrl,
        palette: invitePalette
      });
      await sendTitanEmail({
        name: username,
        subject: `${company.name} invited you to ${getPlatformName()}`,
        message: [
          `${req.user.username} invited you to join ${company.name} on ${getPlatformName()}.`,
          `Role: ${role}`,
          passwordLine,
          `Sign in: ${signInUrl}`
        ].join('\n\n'),
        recipientEmail: email,
        htmlContent: inviteHtml
      });
      inviteEmailSent = true;
    } catch (inviteEmailError) {
      console.warn('Failed to send member invite email:', inviteEmailError.message);
    }

    res.status(201).json({
      message: 'Team member created successfully',
      member: {
        username: newMember.username,
        email: newMember.email,
        role: newMember.role,
        active: true,
        simulationTokens: newMember.simulationTokens
      },
      inviteEmailSent,
      temporaryPassword: !password ? generatedPassword : undefined
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/company/members/:username', ensureMongoConnected, authenticateToken, requireCompanyAdmin, async (req, res) => {
  try {
    const targetUsername = req.params.username;
    if (!targetUsername) {
      return res.status(400).json({ error: 'username path param is required' });
    }

    const targetMember = await usersCollection.findOne({
      username: targetUsername,
      companyId: req.user.companyId
    });
    if (!targetMember) {
      return res.status(404).json({ error: 'Member not found' });
    }

    const updates = {};

    if (Object.prototype.hasOwnProperty.call(req.body, 'role')) {
      const nextRole = req.body.role;
      if (!['member', 'admin'].includes(nextRole)) {
        return res.status(400).json({ error: 'role must be member or admin' });
      }
      if (targetMember.role === 'owner') {
        return res.status(400).json({ error: 'Owner role cannot be changed' });
      }
      updates.role = nextRole;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'active')) {
      if (typeof req.body.active !== 'boolean') {
        return res.status(400).json({ error: 'active must be a boolean' });
      }
      if (targetMember.role === 'owner' && req.body.active === false) {
        return res.status(400).json({ error: 'Owner cannot be disabled' });
      }
      if (targetMember.username === req.user.username && req.body.active === false) {
        return res.status(400).json({ error: 'You cannot disable your own account' });
      }
      updates.active = req.body.active;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'simulationTokens')) {
      const tokens = Number(req.body.simulationTokens);
      if (!Number.isFinite(tokens) || tokens < 0) {
        return res.status(400).json({ error: 'simulationTokens must be 0 or a positive number' });
      }
      updates.simulationTokens = Math.floor(tokens);
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No supported update fields provided' });
    }

    await usersCollection.updateOne(
      { username: targetUsername, companyId: req.user.companyId },
      { $set: { ...updates, updatedAt: new Date() } }
    );

    await recordAuditEvent(req, 'company.member.update', {
      targetType: 'user',
      targetId: targetUsername,
      updates
    });

    res.json({ message: 'Member updated successfully', updates });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/company/members/:username', ensureMongoConnected, authenticateToken, requireCompanyAdmin, async (req, res) => {
  try {
    const targetUsername = req.params.username;
    if (!targetUsername) {
      return res.status(400).json({ error: 'username path param is required' });
    }
    if (targetUsername === req.user.username) {
      return res.status(400).json({ error: 'You cannot remove your own account' });
    }

    const targetMember = await usersCollection.findOne({
      username: targetUsername,
      companyId: req.user.companyId
    });
    if (!targetMember) {
      return res.status(404).json({ error: 'Member not found' });
    }
    if (targetMember.role === 'owner') {
      return res.status(400).json({ error: 'Owner cannot be removed' });
    }

    await usersCollection.deleteOne({
      username: targetUsername,
      companyId: req.user.companyId
    });

    await recordAuditEvent(req, 'company.member.delete', {
      targetType: 'user',
      targetId: targetUsername
    });

    res.json({ message: 'Member removed successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/company/audit-logs', ensureMongoConnected, authenticateToken, requireCompanyAdmin, async (req, res) => {
  try {
    if (!req.user.companyId) {
      return res.status(400).json({ error: 'Company context is required' });
    }

    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 500) : 100;
    const filter = { companyId: req.user.companyId };
    if (req.query.action) filter.action = req.query.action;
    if (req.query.status) filter.status = req.query.status;

    const logs = await auditLogsCollection.find(filter)
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();

    res.json({ logs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Direct Asinex API Proxy Endpoints
/**
 * @swagger
 * /api/exact/{smiles}:
 *   get:
 *     summary: Get molecule by exact SMILES structure (direct Asinex API proxy)
 *     tags: [Asinex Direct API]
 *     parameters:
 *       - in: path
 *         name: smiles
 *         required: true
 *         schema:
 *           type: string
 *         description: URL-encoded SMILES string for exact structure match
 *         example: COc1ccc%28cc1%29n2c%28nnc2SCc3ccccc3%29c4ccncc4
 *     responses:
 *       200:
 *         description: Molecule details for exact SMILES match
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       404:
 *         description: No exact match found
 *       500:
 *         description: Server error
 */
app.get('/api/exact/:smiles', ensureMongoConnected, authenticateToken, requireActiveUser, async (req, res) => {
  try {
    const { smiles } = req.params;
    const { catalogApiBase } = await getRequestLigandServiceConfig(req);
    
    if (!smiles) {
      return res.status(400).json({ error: 'SMILES string is required' });
    }
    
    // Forward the request directly to Asinex API
    const response = await fetch(`${catalogApiBase}/api/exact/${smiles}`, {
      method: 'GET',
      headers: {
        'Accept': '*/*',
        'Content-Type': 'application/json'
      }
    });
    
    // Forward the status code and response
    const data = await response.text();
    
    // Try to parse as JSON, if it fails return as text
    let responseData;
    try {
      responseData = JSON.parse(data);
    } catch {
      responseData = data;
    }
    
    res.status(relayUpstreamStatus(response.status));
    
    // Set appropriate content type based on response
    if (response.headers.get('content-type')) {
      res.setHeader('Content-Type', response.headers.get('content-type'));
    }
    
    // Send the response
    if (typeof responseData === 'object') {
      res.json(responseData);
    } else {
      res.send(responseData);
    }
    
  } catch (error) {
    console.error('Asinex API proxy error:', error);
    res.status(500).json({ 
      error: 'Failed to connect to Asinex API', 
      details: error.message 
    });
  }
});

/**
 * @swagger
 * /api/all/{id}_{pageSize}:
 *   get:
 *     summary: Get all molecules with pagination (direct Asinex API proxy)
 *     tags: [Asinex Direct API]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Starting ID for pagination
 *       - in: path
 *         name: pageSize
 *         required: true
 *         schema:
 *           type: integer
 *         description: Number of molecules per page
 *     responses:
 *       200:
 *         description: List of molecules from Asinex API
 *       500:
 *         description: Server error
 */
app.get('/api/all/:id_:pageSize', ensureMongoConnected, authenticateToken, requireActiveUser, async (req, res) => {
  try {
    const { id, pageSize } = req.params;
    const { catalogApiBase } = await getRequestLigandServiceConfig(req);
    
    // Forward the request directly to Asinex API
    const response = await fetch(`${catalogApiBase}/api/all/${id}_${pageSize}`, {
      method: 'GET',
      headers: {
        'Accept': '*/*',
        'Content-Type': 'application/json'
      }
    });
    
    const data = await response.text();
    let responseData;
    try {
      responseData = JSON.parse(data);
    } catch {
      responseData = data;
    }
    
    res.status(relayUpstreamStatus(response.status));
    if (response.headers.get('content-type')) {
      res.setHeader('Content-Type', response.headers.get('content-type'));
    }
    
    if (typeof responseData === 'object') {
      res.json(responseData);
    } else {
      res.send(responseData);
    }
    
  } catch (error) {
    console.error('Asinex API proxy error:', error);
    res.status(500).json({ 
      error: 'Failed to connect to Asinex API', 
      details: error.message 
    });
  }
});

/**
 * @swagger
 * /api/id/{id_number}:
 *   get:
 *     summary: Get molecule by ID (direct Asinex API proxy)
 *     tags: [Asinex Direct API]
 *     parameters:
 *       - in: path
 *         name: id_number
 *         required: true
 *         schema:
 *           type: string
 *         description: Molecule ID to retrieve
 *     responses:
 *       200:
 *         description: Molecule details from Asinex API
 *       404:
 *         description: Molecule not found
 *       500:
 *         description: Server error
 */
app.get('/api/id/:id_number', ensureMongoConnected, authenticateToken, requireActiveUser, async (req, res) => {
  try {
    const { id_number } = req.params;
    const { catalogApiBase } = await getRequestLigandServiceConfig(req);
    
    // Forward the request directly to Asinex API
    const response = await fetch(`${catalogApiBase}/api/id/${id_number}`, {
      method: 'GET',
      headers: {
        'Accept': '*/*',
        'Content-Type': 'application/json'
      }
    });
    
    const data = await response.text();
    let responseData;
    try {
      responseData = JSON.parse(data);
    } catch {
      responseData = data;
    }
    
    res.status(relayUpstreamStatus(response.status));
    if (response.headers.get('content-type')) {
      res.setHeader('Content-Type', response.headers.get('content-type'));
    }
    
    if (typeof responseData === 'object') {
      res.json(responseData);
    } else {
      res.send(responseData);
    }
    
  } catch (error) {
    console.error('Asinex API proxy error:', error);
    res.status(500).json({ 
      error: 'Failed to connect to Asinex API', 
      details: error.message 
    });
  }
});

/**
 * @swagger
 * /api/api4/bas:
 *   post:
 *     summary: Direct proxy to Asinex API /api4/bas
 *     tags: [Asinex Direct API]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fromId:
 *                 type: integer
 *               pageSize:
 *                 type: integer
 *               bas:
 *                 type: string
 *               smiles:
 *                 type: string
 *               similarity:
 *                 type: number
 *               mwFrom:
 *                 type: number
 *               mwTo:
 *                 type: number
 *           example:
 *             fromId: 1
 *             pageSize: 10
 *             bas: "ASN 10347642,ASN 10344384,ASN 06978457"
 *            
 *             similarity: 0
 *             mwFrom: 0
 *             mwTo: 0
 *     responses:
 *       200:
 *         description: Asinex API response
 */
app.post('/api/api4/bas', ensureMongoConnected, authenticateToken, requireActiveUser, async (req, res) => {
  try {
    const { catalogApiBase } = await getRequestLigandServiceConfig(req);
    const response = await fetch(`${catalogApiBase}/api4/bas`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(req.body)
    });

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }

    res.status(relayUpstreamStatus(response.status));
    if (response.headers.get('content-type')) {
      res.setHeader('Content-Type', response.headers.get('content-type'));
    }
    if (typeof data === 'object') {
      res.json(data);
    } else {
      res.send(data);
    }
  } catch (error) {
    console.error('Asinex API proxy error (/api4/bas):', error);
    res.status(500).json({ error: 'Failed to connect to Asinex API', details: error.message });
  }
});

/**
 * @swagger
 * /api/api4/structure:
 *   post:
 *     summary: Direct proxy to Asinex API /api4/structure
 *     tags: [Asinex Direct API]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fromId:
 *                 type: integer
 *               pageSize:
 *                 type: integer
 *               bas:
 *                 type: string
 *               smiles:
 *                 type: string
 *               similarity:
 *                 type: number
 *               mwFrom:
 *                 type: number
 *               mwTo:
 *                 type: number
 *           example:
 *             fromId: -1
 *             pageSize: 10
 *             bas: bas103456
 *             smiles: C#Cc1c(Br)c(CC)c(C#C)cc1
 *             similarity: 1
 *             mwFrom: 1
 *             mwTo: 10
 *     responses:
 *       200:
 *         description: Asinex API response
 */
app.post('/api/api4/structure', ensureMongoConnected, authenticateToken, requireActiveUser, async (req, res) => {
  try {
    const { catalogApiBase } = await getRequestLigandServiceConfig(req);
    const response = await fetch(`${catalogApiBase}/api4/structure`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(req.body)
    });

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }

    res.status(relayUpstreamStatus(response.status));
    if (response.headers.get('content-type')) {
      res.setHeader('Content-Type', response.headers.get('content-type'));
    }
    if (typeof data === 'object') {
      res.json(data);
    } else {
      res.send(data);
    }
  } catch (error) {
    console.error('Asinex API proxy error (/api4/structure):', error);
    res.status(500).json({ error: 'Failed to connect to Asinex API', details: error.message });
  }
});

/**
 * @swagger
 * /api/api4/substructure:
 *   post:
 *     summary: Direct proxy to Asinex API /api4/substructure
 *     tags: [Asinex Direct API]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fromId:
 *                 type: integer
 *               pageSize:
 *                 type: integer
 *               bas:
 *                 type: string
 *               smiles:
 *                 type: string
 *               similarity:
 *                 type: number
 *               mwFrom:
 *                 type: number
 *               mwTo:
 *                 type: number
 *           example:
 *             fromId: -1
 *             pageSize: 10
 *             bas: bas103456
 *             smiles: C#Cc1c(Br)c(CC)c(C#C)cc1
 *             similarity: 1
 *             mwFrom: 1
 *             mwTo: 10
 *     responses:
 *       200:
 *         description: Asinex API response
 */
app.post('/api/api4/substructure', ensureMongoConnected, authenticateToken, requireActiveUser, async (req, res) => {
  try {
    const { catalogApiBase } = await getRequestLigandServiceConfig(req);
    const response = await fetch(`${catalogApiBase}/api4/substructure`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(req.body)
    });

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }

    res.status(relayUpstreamStatus(response.status));
    if (response.headers.get('content-type')) {
      res.setHeader('Content-Type', response.headers.get('content-type'));
    }
    if (typeof data === 'object') {
      res.json(data);
    } else {
      res.send(data);
    }
  } catch (error) {
    console.error('Asinex API proxy error (/api4/substructure):', error);
    res.status(500).json({ error: 'Failed to connect to Asinex API', details: error.message });
  }
});

/**
 * @swagger
 * /api/api4/similarity:
 *   post:
 *     summary: Direct proxy to Asinex API /api4/similarity
 *     tags: [Asinex Direct API]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fromId:
 *                 type: integer
 *               pageSize:
 *                 type: integer
 *               bas:
 *                 type: string
 *               smiles:
 *                 type: string
 *               similarity:
 *                 type: number
 *               mwFrom:
 *                 type: number
 *               mwTo:
 *                 type: number
 *           example:
 *             fromId: -1
 *             pageSize: 10
 *             bas: bas103456
 *             smiles: C#Cc1c(Br)c(CC)c(C#C)cc1
 *             similarity: 1
 *             mwFrom: 1
 *             mwTo: 10
 *     responses:
 *       200:
 *         description: Asinex API response
 */
app.post('/api/api4/similarity', ensureMongoConnected, authenticateToken, requireActiveUser, async (req, res) => {
  try {
    const { catalogApiBase } = await getRequestLigandServiceConfig(req);
    const response = await fetch(`${catalogApiBase}/api4/similarity`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(req.body)
    });

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }

    res.status(relayUpstreamStatus(response.status));
    if (response.headers.get('content-type')) {
      res.setHeader('Content-Type', response.headers.get('content-type'));
    }
    if (typeof data === 'object') {
      res.json(data);
    } else {
      res.send(data);
    }
  } catch (error) {
    console.error('Asinex API proxy error (/api4/similarity):', error);
    res.status(500).json({ error: 'Failed to connect to Asinex API', details: error.message });
  }
});

/**
 * @swagger
 * /api/api4/mw:
 *   post:
 *     summary: Direct proxy to Asinex API /api4/mw
 *     tags: [Asinex Direct API]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fromId:
 *                 type: integer
 *               pageSize:
 *                 type: integer
 *               bas:
 *                 type: string
 *               smiles:
 *                 type: string
 *               similarity:
 *                 type: number
 *               mwFrom:
 *                 type: number
 *               mwTo:
 *                 type: number
 *           example:
 *             fromId: -1
 *             pageSize: 10
 *             bas: bas103456
 *             smiles: C#Cc1c(Br)c(CC)c(C#C)cc1
 *             similarity: 1
 *             mwFrom: 1
 *             mwTo: 10
 *     responses:
 *       200:
 *         description: Asinex API response
 */
app.post('/api/api4/mw', ensureMongoConnected, authenticateToken, requireActiveUser, async (req, res) => {
  try {
    const { catalogApiBase } = await getRequestLigandServiceConfig(req);
    const response = await fetch(`${catalogApiBase}/api4/mw`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(req.body)
    });

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }

    res.status(relayUpstreamStatus(response.status));
    if (response.headers.get('content-type')) {
      res.setHeader('Content-Type', response.headers.get('content-type'));
    }
    if (typeof data === 'object') {
      res.json(data);
    } else {
      res.send(data);
    }
  } catch (error) {
    console.error('Asinex API proxy error (/api4/mw):', error);
    res.status(500).json({ error: 'Failed to connect to Asinex API', details: error.message });
  }
});

/**
 * @swagger
 * /api/diffdock/generate:
 *   post:
 *     summary: Generate molecular docking poses using DiffDock
 *     tags: [Asinex Direct API]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               protein:
 *                 type: string
 *                 description: Protein structure (PDB format or identifier)
 *               ligand:
 *                 type: string
 *                 description: Ligand structure
 *               ligandFileType:
 *                 type: string
 *                 enum: [mol2, sdf, pdb]
 *                 default: mol2
 *                 description: File type of the ligand
 *               num_poses:
 *                 type: integer
 *                 default: 10
 *                 description: Number of poses to generate
 *               time_divisions:
 *                 type: integer
 *                 default: 20
 *                 description: Number of time divisions for diffusion
 *               steps:
 *                 type: integer
 *                 default: 18
 *                 description: Number of diffusion steps
 *               save_trajectory:
 *                 type: boolean
 *                 default: false
 *                 description: Whether to save the trajectory
 *               skip_gen_conformer:
 *                 type: boolean
 *                 default: false
 *                 description: Whether to skip conformer generation
 *               is_staged:
 *                 type: boolean
 *                 default: false
 *                 description: Whether to use staged inference
 *             required:
 *               - protein
 *               - ligand
 *           example:
 *             protein: "1cx7"
 *             ligand: "ZU5"
 *             ligand_file_type: sdf
 *             num_poses: 1
 *             time_divisions: 20
 *             steps: 18
 *             save_trajectory: false
 *             skip_gen_conformer: false
 *             is_staged: false
 *     responses:
 *       200:
 *         description: DiffDock docking results with generated poses
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: Invalid request parameters
 *       500:
 *         description: Server error or DiffDock service unavailable
 */
app.post('/api/diffdock/generate', ensureMongoConnected, authenticateToken, requireActiveUser, consumeSimulationToken('diffdock'), async (req, res) => {
  try {
    const { diffdockApiUrl } = await getRequestLigandServiceConfig(req);
    const {
      protein,
      ligandFileType = 'sdf',
      ligand,     
      time_divisions = 20,
      steps = 18,
      save_trajectory = false,
      is_staged = false
    } = req.body;

    if (!protein || !ligand) {
      return res.status(400).json({ error: 'protein and ligand are required' });
    }
  
    var ligand_bytes;
    var ligand_raw;
    try {
        const pdbResponse = await fetch(`https://files.rcsb.org/download/${protein.toUpperCase()}.pdb`, {
          method: 'GET',
          headers: {
            'Accept': 'text/plain'
          }
        });

        if (!pdbResponse.ok) {
          return res.status(400).json({ error: `Failed to fetch protein PDB file: ${pdbResponse.statusText}` });
        }

        const pdbContent = await pdbResponse.text();
        
        // Extract only ATOM lines and escape newlines
        const atomLines = pdbContent
          .split('\n')
          .filter(line => line.startsWith('ATOM'))
          .join('\n');
        
        var protein_bytes = atomLines.replace(/\n/g, '\\\n');

      
        if(ligand.length < 4) //its a ligandId
          {
          // Fetch and process ligand SDF file
          const sdfResponse = await fetch(`https://files.rcsb.org/ligands/download/${ligand}_ideal.sdf`, {
            method: 'GET',
            headers: {
              'Accept': 'text/plain'
            }
          });

          if (!sdfResponse.ok) {
            return res.status(400).json({ error: `Failed to fetch ligand SDF file: ${sdfResponse.statusText}` });
          }

          const sdfContent = await sdfResponse.text();
          const normalizedSdf = sdfContent.replace(/\r\n/g, '\n');
          const sdfWithDelimiter = normalizedSdf.includes('$$$$') ? normalizedSdf : `${normalizedSdf}\n$$$$\n`;
          ligand_raw = sdfWithDelimiter;
          ligand_bytes = sdfWithDelimiter.replace(/\n/g, '\\\n');

        }
        else{
          const smilesRequestBody = { smiles: ligand };
          logToFile('SMILES->SDF REQUEST: ' + JSON.stringify(smilesRequestBody));
          const sdfResponse = await fetch(SDF_CONVERTER_URL, {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(smilesRequestBody)
          });

          if (!sdfResponse.ok) {
            logToFile('SMILES->SDF RESPONSE ERROR: ' + sdfResponse.statusText);
            return res.status(400).json({ error: `Failed to convert SMILES to SDF: ${sdfResponse.statusText}` });
          }

          const sdfJson = await sdfResponse.json();
          logToFile('SMILES->SDF RESPONSE: ' + JSON.stringify(sdfJson));
          const sdfContent = sdfJson.sdf;
          const normalizedSdf = sdfContent.replace(/\r\n/g, '\n');
          const sdfWithDelimiter = normalizedSdf.includes('$$$$') ? normalizedSdf : `${normalizedSdf}\n$$$$\n`;
          ligand_raw = sdfWithDelimiter;
          ligand_bytes = sdfWithDelimiter.replace(/\n/g, '\\n');
        }
    } 
    catch (error) {
      return res.status(400).json({ error: `Failed to fetch protein PDB or ligand SDF file: ${error.message}` });
    }

    
    const makeDiffDockRequest = async (ligandPayload) => {
      const requestBody = {
        ligand: ligandPayload,
        ligand_file_type: ligandFileType,
        protein: protein_bytes,
        num_poses: 100,
        time_divisions: time_divisions,
        steps: steps,
        save_trajectory: save_trajectory,
        is_staged: is_staged
      };
      logToFile('makeDiffDockRequest REQUEST: ' + JSON.stringify(requestBody));
      const response = await fetch(diffdockApiUrl, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch { data = text; }
      logToFile('makeDiffDockRequest RESPONSE: ' + text);
      return { response, data };
    };

    let { response, data } = await makeDiffDockRequest(ligand_bytes);

    const detailsMessage = typeof data === 'object' && data !== null ? data.details : null;
    if (detailsMessage && typeof detailsMessage === 'string' && detailsMessage.includes('Fail to read ligand molecule description') && ligand_raw && ligand_raw !== ligand_bytes) {
      console.warn('DiffDock failed to parse escaped ligand; retrying with raw ligand content.');
      ({ response, data } = await makeDiffDockRequest(ligand_raw));
    }

    res.status(relayUpstreamStatus(response.status));
    if (response.headers.get('content-type')) {
      res.setHeader('Content-Type', response.headers.get('content-type'));
    }
    if (typeof data === 'object') {
      res.json(data);
    } else {
      res.send(data);
    }
  } catch (error) {
    console.error('DiffDock API proxy error:', error);
    res.status(500).json({ error: 'Failed to connect to DiffDock API', details: error.message });
  }
});

/**
 * @swagger
 * /api/diffdock/generate_file:
 *   post:
 *     summary: Generate molecular docking poses using DiffDock script and return output.json
 *     tags: [DiffDock]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               protein:
 *                 type: string
 *                 description: Protein structure (PDB format or identifier)
 *               ligand:
 *                 type: string
 *                 description: Ligand structure (SMILES or SDF format)
 *             required:
 *               - protein
 *               - ligand
 *           example:
 *             protein: "1A2B"
 *             ligand: "CC(=O)Oc1ccccc1C(=O)O"
 *     responses:
 *       200:
 *         description: DiffDock output.json file containing docking results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: Invalid request parameters
 *       500:
 *         description: Server error or script execution failed
 */
app.post('/api/diffdock/generate_file', ensureMongoConnected, authenticateToken, requireActiveUser, consumeSimulationToken('diffdock-file'), async (req, res) => {
  try {
    const { protein, ligand } = req.body;

    if (!protein || !ligand) {
      return res.status(400).json({ error: 'protein and ligand are required' });
    }
    // protein is a PDB entry id, ligand a chemical component id. Reject anything
    // else before it reaches the shell script.
    if (!/^[A-Za-z0-9]{4}$/.test(protein)) {
      return res.status(400).json({ error: 'protein must be a 4-character PDB ID' });
    }
    if (!/^[A-Za-z0-9]{1,8}$/.test(ligand)) {
      return res.status(400).json({ error: 'ligand must be an alphanumeric component ID' });
    }

    // Each request gets its own work dir — a shared output.json let concurrent
    // requests read each other's docking results.
    const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'diffdock-'));
    const cleanup = () => fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {});

    execFile('./diff_dock.sh', [protein, ligand, workDir], { cwd: process.cwd() }, (error, stdout, stderr) => {
      if (error) {
        console.error('Script execution error:', error);
        console.error('stderr:', stderr);
        cleanup();
        return res.status(500).json({ error: 'Failed to execute DiffDock script' });
      }

      fs.readFile(path.join(workDir, 'output.json'), 'utf8', (readError, data) => {
        if (readError) {
          console.error('File read error:', readError);
          cleanup();
          return res.status(500).json({ error: 'DiffDock produced no output' });
        }

        try {
          const jsonData = JSON.parse(data);
          res.json({
            success: true,
            message: 'DiffDock script executed successfully',
            data: jsonData,
            timestamp: new Date().toISOString()
          });
        } catch (parseError) {
          console.error('JSON parse error:', parseError);
          res.status(500).json({ error: 'DiffDock output could not be parsed' });
        } finally {
          cleanup();
        }
      });
    });
  } catch (error) {
    console.error('DiffDock script API error:', error);
    res.status(500).json({ error: 'Failed to execute DiffDock script' });
  }
});

// Asinex API Wrapper Endpoints

/**
 * @swagger
 * /api/asinex/all/{id}_{pageSize}:
 *   get:
 *     summary: Get all molecules with pagination from Asinex API
 *     tags: [Asinex Wrapper]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Starting ID for pagination
 *       - in: path
 *         name: pageSize
 *         required: true
 *         schema:
 *           type: integer
 *         description: Number of molecules per page
 *     responses:
 *       200:
 *         description: List of molecules from Asinex API
 *       500:
 *         description: Server error
 */
app.get('/api/asinex/all/:id_:pageSize', ensureMongoConnected, authenticateToken, requireActiveUser, async (req, res) => {
  try {
    const { id_, pageSize } = req.params;
    const { catalogApiBase } = await getRequestLigandServiceConfig(req);
    
    if (!id_ || !pageSize ) {
      return res.status(400).json({ error: '_id, pageSize are all required' });
    }

    const response = await fetch(`${catalogApiBase}/api/all/${id_}_${pageSize.replace('_', '')}`, {
      method: 'GET' 
    });
    
    if (!response.ok) {
      throw new Error(`Asinex API responded with status: ${response.status}`);
    }
    
    const data = await response.json();
    
      res.json(data);
  } catch (error) {
    console.error('Asinex API error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch from Asinex API', 
      details: error.message 
    });
  }
});

/**
 * @swagger
 * /api/asinex/id/{id_number}:
 *   get:
 *     summary: Get molecule by ID from Asinex API
 *     tags: [Asinex Wrapper]
 *     parameters:
 *       - in: path
 *         name: id_number
 *         required: true
 *         schema:
 *           type: string
 *         description: Molecule ID to retrieve
 *     responses:
 *       200:
 *         description: Molecule details from Asinex API
 *       404:
 *         description: Molecule not found
 *       500:
 *         description: Server error
 */
app.get('/api/asinex/id/:id_number', ensureMongoConnected, authenticateToken, requireActiveUser, async (req, res) => {
  try {
    const { id_number } = req.params;
    const { catalogApiBase } = await getRequestLigandServiceConfig(req);
    
    if (!id_number) {
      return res.status(400).json({ error: 'id_number is required' });
    }
    
    const response = await fetch(`${catalogApiBase}/api/id/${encodeURIComponent(id_number)}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });
    
    if (response.status === 404) {
      return res.status(404).json({ error: 'Molecule not found in Asinex database' });
    }
    
    if (!response.ok) {
      throw new Error(`Asinex API responded with status: ${response.status}`);
    }
    
    const data = await response.json();
    
    res.json({
      source: 'asinex',
      id: id_number,
      data
    });
  } catch (error) {
    console.error('Asinex API error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch from Asinex API', 
      details: error.message 
    });
  }
});

/**
 * @swagger
 * /api/asinex/exact/{smiles}:
 *   get:
 *     summary: Get molecule by exact SMILES structure from Asinex API
 *     tags: [Asinex Wrapper]
 *     parameters:
 *       - in: path
 *         name: smiles
 *         required: true
 *         schema:
 *           type: string
 *         description: SMILES string for exact structure match
 *     responses:
 *       200:
 *         description: Molecule details for exact SMILES match
 *       404:
 *         description: No exact match found
 *       500:
 *         description: Server error
 */
app.get('/api/asinex/exact/:smiles', ensureMongoConnected, authenticateToken, requireActiveUser, async (req, res) => {
  try {
    const { smiles } = req.params;
    const { catalogApiBase } = await getRequestLigandServiceConfig(req);
    
    if (!smiles) {
      return res.status(400).json({ error: 'SMILES string is required' });
    }
    
    const response = await fetch(`${catalogApiBase}/api/exact/${encodeURIComponent(smiles)}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });
    
    if (response.status === 404) {
      return res.status(404).json({ error: 'No exact SMILES match found in Asinex database' });
    }
    
    if (!response.ok) {
      throw new Error(`Asinex API responded with status: ${response.status}`);
    }
    
    const data = await response.json();
    
    res.json({
      source: 'asinex',
      searchType: 'exact',
      smiles: smiles,
      data
    });
  } catch (error) {
    console.error('Asinex API error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch from Asinex API', 
      details: error.message 
    });
  }
});

/**
 * @swagger
 * /api/asinex/substructure/{id}_{pageSize}/{smiles}:
 *   get:
 *     summary: Get molecules by substructure search from Asinex API
 *     tags: [Asinex Wrapper]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Starting ID for pagination
 *       - in: path
 *         name: pageSize
 *         required: true
 *         schema:
 *           type: integer
 *         description: Number of molecules per page
 *       - in: path
 *         name: smiles
 *         required: true
 *         schema:
 *           type: string
 *         description: SMILES string for substructure search
 *     responses:
 *       200:
 *         description: Molecules containing the substructure
 *       404:
 *         description: No substructure matches found
 *       500:
 *         description: Server error
 */
app.get('/api/asinex/substructure/:id_:pageSize/:smiles', ensureMongoConnected, authenticateToken, requireActiveUser, async (req, res) => {
  try {
    const { id_, pageSize, smiles } = req.params;
    const { catalogApiBase } = await getRequestLigandServiceConfig(req);
    
    if (!id_ || !pageSize || !smiles) {
      return res.status(400).json({ error: '_id, pageSize, and SMILES are all required' });
    }
  let uri =`${catalogApiBase}/api/substructure/${id_}_${pageSize.replace('_', '')}/${encodeURIComponent(smiles)}`;
    const response = await fetch(uri, {      method: 'GET'     });

    if (response.status === 404) {
      return res.status(404).json({ error: 'No substructure matches found in Asinex database' });
    }
    
    if (!response.ok) {
      throw new Error(`Asinex API responded with status: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Return the data directly as received from Asinex API
    res.json(data);
  } catch (error) {
    console.error('Asinex API error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch from Asinex API', 
      details: error.message 
    });
  }
});

/**
 * @swagger
 * /api/asinex/search:
 *   post:
 *     summary: Advanced search wrapper for Asinex API
 *     tags: [Asinex Wrapper]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               searchType:
 *                 type: string
 *                 enum: [all, id, exact, substructure]
 *                 description: Type of search to perform
 *               id:
 *                 type: integer
 *                 description: Starting ID (for pagination searches)
 *               pageSize:
 *                 type: integer
 *                 description: Page size (for pagination searches)
 *               id_number:
 *                 type: string
 *                 description: Specific molecule ID (for ID search)
 *               smiles:
 *                 type: string
 *                 description: SMILES string (for structure searches)
 *             required:
 *               - searchType
 *     responses:
 *       200:
 *         description: Search results from Asinex API
 *       400:
 *         description: Invalid search parameters
 *       500:
 *         description: Server error
 */
app.post('/api/asinex/search', ensureMongoConnected, authenticateToken, requireActiveUser, async (req, res) => {
  try {
    const { searchType, id, pageSize, id_number, smiles } = req.body;
    const { catalogApiBase } = await getRequestLigandServiceConfig(req);
    
    if (!searchType) {
      return res.status(400).json({ error: 'searchType is required' });
    }
    
    let apiUrl;
    let searchParams = {};
    
    switch (searchType) {
      case 'all':
        if (!id || !pageSize) {
          return res.status(400).json({ error: 'id and pageSize are required for all search' });
        }
        apiUrl = `${catalogApiBase}/api/all/${id}_${pageSize}`;
        searchParams = { id, pageSize };
        break;
        
      case 'id':
        if (!id_number) {
          return res.status(400).json({ error: 'id_number is required for ID search' });
        }
        apiUrl = `${catalogApiBase}/api/id/${encodeURIComponent(id_number)}`;
        searchParams = { id_number };
        break;
        
      case 'exact':
        if (!smiles) {
          return res.status(400).json({ error: 'smiles is required for exact search' });
        }
        apiUrl = `${catalogApiBase}/api/exact/${encodeURIComponent(smiles)}`;
        searchParams = { smiles };
        break;
        
      case 'substructure':
        if (!id || !pageSize || !smiles) {
          return res.status(400).json({ error: 'id, pageSize, and smiles are required for substructure search' });
        }
        apiUrl = `${catalogApiBase}/api/substructure/${id}_${pageSize}/${encodeURIComponent(smiles)}`;
        searchParams = { id, pageSize, smiles };
        break;
        
      default:
        return res.status(400).json({ error: 'Invalid searchType. Must be one of: all, id, exact, substructure' });
    }
    
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });
    
    if (response.status === 404) {
      return res.status(404).json({ error: 'No results found in Asinex database' });
    }
    
    if (!response.ok) {
      throw new Error(`Asinex API responded with status: ${response.status}`);
    }
    
    const data = await response.json();
    
    res.json({
      source: 'asinex',
      searchType,
      searchParams,
      timestamp: new Date().toISOString(),
      data
    });
  } catch (error) {
    console.error('Asinex API error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch from Asinex API', 
      details: error.message 
    });
  }
});

/**
 * @swagger
 * /api/asinex/health:
 *   get:
 *     summary: Check Asinex API health status
 *     tags: [Asinex Wrapper]
 *     responses:
 *       200:
 *         description: Asinex API health status
 */
app.get('/api/asinex/health', ensureMongoConnected, authenticateToken, requireActiveUser, async (req, res) => {
  let catalogApiBase = DEFAULT_LIGAND_SERVICE_CONFIG.catalogApiBase;
  try {
    ({ catalogApiBase } = await getRequestLigandServiceConfig(req));
    const response = await fetch(`${catalogApiBase}/api/all/1_1`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      timeout: 5000
    });
    
    const isHealthy = response.ok;
    
    res.json({
      asinexApi: {
        status: isHealthy ? 'healthy' : 'unhealthy',
        baseUrl: catalogApiBase,
        statusCode: response.status,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    res.json({
      asinexApi: {
        status: 'unhealthy',
        baseUrl: catalogApiBase,
        error: error.message,
        timestamp: new Date().toISOString()
      }
    });
  }
});

// Require a valid session for the scientific microservice proxies. These were
// previously mounted with no auth, exposing compute (GROMACS/glioblastoma) and
// the upstream URL path params to anonymous callers.
app.use('/api', ensureMongoConnected, authenticateToken, requireActiveUser, scientificServicesRouter);

const PORT = process.env.PORT || 3000;

// Initialize database and start server
async function startServer() {
  // Initialize database connection
  const dbInitialized = await initializeDatabase();
  
  if (!dbInitialized) {
    console.error('❌ Failed to initialize database. Server will not start.');
    console.error('Please ensure MongoDB is running and accessible.');
    process.exit(1);
  }

  // Try HTTPS first (for production), fallback to HTTP (for development)
  try {
    const sslKeyPath = process.env.SSL_KEY_PATH;
    const sslCertPath = process.env.SSL_CERT_PATH;
    if (!sslKeyPath || !sslCertPath) {
      throw new Error('SSL_KEY_PATH and SSL_CERT_PATH are not configured');
    }
    const httpsOptions = {
      key: fs.readFileSync(sslKeyPath),
      cert: fs.readFileSync(sslCertPath)
    };
    https.createServer(httpsOptions, app).listen(PORT, '0.0.0.0', () => {
      console.log(`✅ HTTPS Server running on port ${PORT}`);
      console.log(`📚 API Documentation: https://localhost:${PORT}/api-docs`);
    });
  } catch (error) {
    console.log('SSL certificates not found, starting HTTP server for development...');
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`✅ HTTP Server running on port ${PORT}`);
      console.log(`📚 API Documentation: http://localhost:${PORT}/api-docs`);
      console.log(`🔍 Health Check: http://localhost:${PORT}/health`);
    });
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down server...');
  try {
    await client.close();
    console.log('✓ MongoDB connection closed');
  } catch (err) {
    console.error('Error closing MongoDB connection:', err);
  }
  process.exit(0);
});

/**
 * @swagger
 * /create-checkout-session:
 *   post:
 *     summary: Create a Stripe checkout session
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               planName:
 *                 type: string
 *               price:
 *                 type: number
 *               isYearly:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Checkout session created
 */

/**
 * @swagger
 * /checkout-session/{sessionId}:
 *   get:
 *     summary: Get Stripe checkout session details
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Session details
 */

/**
 * @swagger
 * /api/hello:
 *   get:
 *     summary: Returns hello data
 *     responses:
 *       200:
 *         description: Returns hello
 */

/**
 * @swagger
 * /api/data:
 *   post:
 *     summary: Echoes POSTed data
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Echoed data
 */

/**
 * @swagger
 * /api/shop:
 *   post:
 *     summary: Proxy to external Shop API (requires JWT)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Shop API response
 */

/**
 * @swagger
 * /api/simulation:
 *   get:
 *     summary: Run simulation (requires JWT)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: pdbid
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: smiles
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Simulation result
 */

/**
 * @swagger
 * /api/simulation-logs:
 *   get:
 *     summary: Get simulation logs for the authenticated user
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of simulation logs
 */

/**
 * @swagger
 * /api/sanitized/{simulationKey}:
 *   get:
 *     summary: Download sanitized PDB file by simulationKey (requires JWT)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: simulationKey
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Sanitized PDB file
 */

/**
 * @swagger
 * /api/validate-token:
 *   get:
 *     summary: Validate JWT token
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Token validation result
 */

/**
 * @swagger
 * /api/validate-token:
 *   post:
 *     summary: Validate JWT token (POST)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Token validation result
 */

/**
 * @swagger
 * /api/issueSimulationTokens:
 *   post:
 *     summary: Issue or reset simulationTokens for the authenticated user
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: simulationTokens updated
 */
app.post('/api/billing/claim-trial', ensureMongoConnected, authenticateToken, requireActiveUser, async (req, res) => {
  try {
    const trialPlan = PLAN_CATALOG.Trial;
    const userFilter = req.user.companyId
      ? { username: req.user.username, companyId: req.user.companyId, trialClaimed: { $ne: true } }
      : { username: req.user.username, trialClaimed: { $ne: true } };

    const result = await usersCollection.updateOne(
      userFilter,
      {
        $inc: { simulationTokens: trialPlan.credits },
        $set: {
          trialClaimed: true,
          trialClaimedAt: new Date(),
          updatedAt: new Date()
        }
      }
    );

    if (result.matchedCount === 0) {
      return res.status(409).json({ error: 'Trial tokens have already been claimed' });
    }

    await recordAuditEvent(req, 'billing.trial.claim', {
      targetType: 'user',
      targetId: req.user.username,
      credits: trialPlan.credits
    });

    res.json({ message: 'Trial tokens claimed', credits: trialPlan.credits });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/issueSimulationTokens', ensureMongoConnected, authenticateToken, requireCompanyAdmin, async (req, res) => {
  try {
    const username = typeof req.body.username === 'string' && req.body.username.trim()
      ? req.body.username.trim()
      : req.user.username;
    if (!username) return res.status(400).json({ error: 'No username provided' });
    const amount = typeof req.body.simulationTokens === 'number' && req.body.simulationTokens > 0 ? req.body.simulationTokens : 50;
    const userFilter = { username, companyId: req.user.companyId };
    const result = await usersCollection.updateOne(
      userFilter,
      { $set: { simulationTokens: amount, updatedAt: new Date() } }
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'User not found in your company' });
    }
    await recordAuditEvent(req, 'company.tokens.user_reset', {
      targetType: 'user',
      targetId: username,
      simulationTokens: amount
    });
    res.json({ message: `simulationTokens set to ${amount}`, result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Test email configuration endpoint
app.get('/api/test-email', ensureMongoConnected, authenticateToken, requireCompanyAdmin, async (req, res) => {
  const result = await testEmailConfiguration();
  if (result.success) {
    res.json(result);
  } else {
    res.status(500).json(result);
  }
});

// Email credentials debugging endpoint
app.get('/api/debug-email', ensureMongoConnected, authenticateToken, requireCompanyAdmin, (req, res) => {
  const validation = validateEmailCredentials();
  const help = getTitanMailHelp();
  
  res.json({
    validation,
    help,
    timestamp: new Date().toISOString()
  });
});

// Send test email endpoint
app.post('/api/send-test-email', ensureMongoConnected, authenticateToken, requireCompanyAdmin, async (req, res) => {
  try {
    const { recipientEmail } = req.body;
    
    if (!recipientEmail) {
      return res.status(400).json({ 
        success: false, 
        error: 'recipientEmail is required' 
      });
    }

    await sendTitanEmail({ 
      name: 'Test User',
      subject: 'Test Email from ChemBench',
      message: 'This is a test email to verify SMTP configuration.\n\nIf you receive this, your email setup is working correctly!',
      recipientEmail
    });
    
    res.json({ 
      success: true, 
      message: 'Test email sent successfully',
      sentTo: recipientEmail
    });
  } catch (error) {
    console.error('Test email sending error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to send test email',
      details: error.message
    });
  }
});

/**
 * @swagger
 * /api/send-email:
 *   post:
 *     summary: Send an email using the configured email service
 *     tags: [Email]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: Name of the sender/recipient for email formatting
 *                 example: "John Doe"
 *               subject:
 *                 type: string
 *                 description: Email subject line
 *                 example: "Welcome to ChemBench"
 *               message:
 *                 type: string
 *                 description: Email body/content
 *                 example: "Thank you for joining our platform!"
 *               recipientEmail:
 *                 type: string
 *                 format: email
 *                 description: Email address of the recipient
 *                 example: "user@example.com"
 *             required:
 *               - name
 *               - subject
 *               - message
 *               - recipientEmail
 *     responses:
 *       200:
 *         description: Email sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Email sent successfully"
 *       400:
 *         description: Missing required fields
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "All fields including recipient email are required"
 *       500:
 *         description: Email sending failed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "Failed to send email. Please check email configuration."
 */
// Email sending endpoint
app.post('/api/send-email', publicEmailRateLimit, async (req, res) => {
  try {
    const { name, subject, message, recipientEmail } = req.body;
    if (!name || !subject || !message) {
      return res.status(400).json({
        success: false,
        error: 'name, subject, and message are required'
      });
    }

    // SECURITY: this endpoint is public (contact form). The destination is
    // server-controlled — NOT taken from the request — so it cannot be abused
    // as an open relay to send mail to arbitrary recipients. Any client-supplied
    // recipientEmail is treated only as the visitor's own contact address and
    // surfaced in the body for the support team to reply to.
    const destination = process.env.CONTACT_RECIPIENT || process.env.EMAIL_USER;
    if (!destination) {
      console.error('send-email: no CONTACT_RECIPIENT/EMAIL_USER configured');
      return res.status(500).json({ success: false, error: 'Email destination is not configured' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const senderContact = typeof recipientEmail === 'string' && emailRegex.test(recipientEmail.trim())
      ? recipientEmail.trim()
      : null;

    const bodyWithContact = senderContact
      ? `From: ${name} <${senderContact}>\n\n${message}`
      : `From: ${name}\n\n${message}`;

    await sendTitanEmail({
      name,
      subject: `[Contact] ${subject}`,
      message: bodyWithContact,
      recipientEmail: destination
    });
    res.json({ success: true, message: 'Email sent successfully' });
  } catch (error) {
    console.error('Email sending error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send email. Please check email configuration.'
    });
  }
});


/**
 * @swagger
 * /api/projects:
 *   post:
 *     summary: Create a new project
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *     responses:
 *       200:
 *         description: Project created
 */
app.post('/api/projects', ensureMongoConnected, authenticateToken, requireActiveUser, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Project name is required' });
  try {
    const projectsCollection = client.db().collection('projects');
    const project = {
      name,
      userid: req.user.username, // or req.user.id if you use a numeric id
      companyId: req.user.companyId || null,
      companyName: req.user.companyName || null,
      createdAt: new Date()
    };
    const result = await projectsCollection.insertOne(project);
    await recordAuditEvent(req, 'project.create', {
      targetType: 'project',
      targetId: result.insertedId.toString(),
      name: project.name
    });
    res.json({ message: 'Project created', project: { ...project, id: result.insertedId } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/activity:
 *   get:
 *     summary: Get latest activity (users, projects, simulations)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Latest activity
 */
app.get('/api/activity', ensureMongoConnected, authenticateToken, requireActiveUser, async (req, res) => {
  try {
    const db = client.db();
    const userFilter = req.user.companyId
      ? { companyId: req.user.companyId }
      : { username: req.user.username };
    const projectFilter = req.user.companyId
      ? { companyId: req.user.companyId }
      : { userid: req.user.username };
    const simulationFilter = req.user.companyId
      ? { companyId: req.user.companyId }
      : { 'user.username': req.user.username };
    // Get latest registered users
    const users = await db.collection('users')
      .find(userFilter, { projection: { username: 1, email: 1, companyId: 1, companyName: 1, role: 1, createdAt: 1 } })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();
    // Get latest opened projects
    const projects = await db.collection('projects')
      .find(projectFilter, { projection: { name: 1, userid: 1, companyId: 1, companyName: 1, createdAt: 1 } })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();
    // Get latest executed simulations
    const simulations = await db.collection('simulation_logs')
      .find(simulationFilter, { projection: { pdbid: 1, smiles: 1, user: 1, companyId: 1, companyName: 1, timestamp: 1, simulationKey: 1 } })
      .sort({ timestamp: -1 })
      .limit(50)
      .toArray();
    res.json({ users, projects, simulations });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/molecules:
 *   get:
 *     summary: Get all molecules from mol_price collection
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Maximum number of molecules to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Number of molecules to skip (for pagination)
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search in ASINEX_ID, IUPAC_NAME, or SMILES_STRING
 *       - in: query
 *         name: maxPrice
 *         schema:
 *           type: number
 *         description: Maximum price for 1mg
 *       - in: query
 *         name: minWeight
 *         schema:
 *           type: number
 *         description: Minimum molecular weight
 *       - in: query
 *         name: maxWeight
 *         schema:
 *           type: number
 *         description: Maximum molecular weight
 *     responses:
 *       200:
 *         description: List of molecules
 */
app.get('/api/molecules', ensureMongoConnected, async (req, res) => {
  try {
    const db = client.db();
    const molPriceCollection = db.collection('mol_price');
    
    // Parse query parameters
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const search = req.query.search;
    const maxPrice = req.query.maxPrice ? parseFloat(req.query.maxPrice) : null;
    const minWeight = req.query.minWeight ? parseFloat(req.query.minWeight) : null;
    const maxWeight = req.query.maxWeight ? parseFloat(req.query.maxWeight) : null;
    
    // Build query filter
    let filter = {};
    
    if (search) {
      const safe = escapeRegExp(String(search));
      filter.$or = [
        { ASINEX_ID: { $regex: safe, $options: 'i' } },
        { IUPAC_NAME: { $regex: safe, $options: 'i' } },
        { SMILES_STRING: { $regex: safe, $options: 'i' } },
        { BRUTTO_FORMULA: { $regex: safe, $options: 'i' } }
      ];
    }
    
    if (maxPrice) {
      filter.PRICE_1MG = { $lte: maxPrice };
    }
    
    if (minWeight || maxWeight) {
      filter.MW_STRUCTURE = {};
      if (minWeight) filter.MW_STRUCTURE.$gte = minWeight;
      if (maxWeight) filter.MW_STRUCTURE.$lte = maxWeight;
    }
    
    // Get total count for pagination
    const totalCount = await molPriceCollection.countDocuments(filter);
    
    // Get molecules with pagination
    const molecules = await molPriceCollection
      .find(filter)
      .skip(offset)
      .limit(limit)
      .sort({ ASINEX_ID: 1 })
      .toArray();
    
    res.json({
      molecules,
      pagination: {
        total: totalCount,
        limit,
        offset,
        hasMore: offset + limit < totalCount
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/molecules/{asinexId}:
 *   get:
 *     summary: Get a specific molecule by ASINEX_ID
 *     parameters:
 *       - in: path
 *         name: asinexId
 *         required: true
 *         schema:
 *           type: string
 *         description: The ASINEX_ID of the molecule
 *     responses:
 *       200:
 *         description: Molecule details
 *       404:
 *         description: Molecule not found
 */
app.get('/api/molecules/:asinexId', ensureMongoConnected, async (req, res) => {
  try {
    const db = client.db();
    const molPriceCollection = db.collection('mol_price');
    
    const molecule = await molPriceCollection.findOne({ 
      ASINEX_ID: req.params.asinexId 
    });
    
    if (!molecule) {
      return res.status(404).json({ error: 'Molecule not found' });
    }
    
    res.json(molecule);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/molecules/stats:
 *   get:
 *     summary: Get statistics about the molecule collection
 *     responses:
 *       200:
 *         description: Collection statistics
 */
app.get('/api/molecules/stats', ensureMongoConnected, async (req, res) => {
  try {
    const db = client.db();
    const molPriceCollection = db.collection('mol_price');
    
    const stats = await molPriceCollection.aggregate([
      {
        $group: {
          _id: null,
          totalMolecules: { $sum: 1 },
          avgMolecularWeight: { $avg: '$MW_STRUCTURE' },
          minMolecularWeight: { $min: '$MW_STRUCTURE' },
          maxMolecularWeight: { $max: '$MW_STRUCTURE' },
          avgPrice1mg: { $avg: '$PRICE_1MG' },
          minPrice1mg: { $min: '$PRICE_1MG' },
          maxPrice1mg: { $max: '$PRICE_1MG' },
          totalAvailableMg: { $sum: '$AVAILABLE_MG' }
        }
      }
    ]).toArray();
    
    const result = stats[0] || {};
    delete result._id;
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/molecules/search/smiles:
 *   get:
 *     summary: Search molecules by SMILES pattern
 *     parameters:
 *       - in: query
 *         name: pattern
 *         required: true
 *         schema:
 *           type: string
 *         description: SMILES pattern to search for
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Matching molecules
 */
app.get('/api/molecules/search/smiles', ensureMongoConnected, async (req, res) => {
  try {
    const db = client.db();
    const molPriceCollection = db.collection('mol_price');
    
    const pattern = req.query.pattern;
    const limit = parseInt(req.query.limit) || 20;
    
    if (!pattern) {
      return res.status(400).json({ error: 'Pattern parameter is required' });
    }
    
    const molecules = await molPriceCollection
      .find({
        SMILES_STRING: { $regex: escapeRegExp(String(pattern)), $options: 'i' }
      })
      .limit(limit)
      .toArray();
    
    res.json({
      pattern,
      matches: molecules.length,
      molecules
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/molecules/price-range:
 *   get:
 *     summary: Get molecules within a specific price range
 *     parameters:
 *       - in: query
 *         name: minPrice
 *         required: true
 *         schema:
 *           type: number
 *         description: Minimum price for 1mg
 *       - in: query
 *         name: maxPrice
 *         required: true
 *         schema:
 *           type: number
 *         description: Maximum price for 1mg
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *     responses:
 *       200:
 *         description: Molecules in price range
 */
app.get('/api/molecules/price-range', ensureMongoConnected, async (req, res) => {
  try {
    const db = client.db();
    const molPriceCollection = db.collection('mol_price');
    
    const minPrice = parseFloat(req.query.minPrice);
    const maxPrice = parseFloat(req.query.maxPrice);
    const limit = parseInt(req.query.limit) || 50;
    
    if (!minPrice || !maxPrice) {
      return res.status(400).json({ error: 'Both minPrice and maxPrice are required' });
    }
    
    const molecules = await molPriceCollection
      .find({ 
        PRICE_1MG: { $gte: minPrice, $lte: maxPrice } 
      })
      .limit(limit)
      .sort({ PRICE_1MG: 1 })
      .toArray();
    
    res.json({
      priceRange: { minPrice, maxPrice },
      count: molecules.length,
      molecules
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/simulation/{simulationKey}/admet:
 *   put:
 *     summary: Update simulation with ADMET data
 *     tags: [Simulations]
 *     parameters:
 *       - in: path
 *         name: simulationKey
 *         required: true
 *         schema:
 *           type: string
 *         description: Simulation key to update
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               admet:
 *                 type: object
 *                 description: ADMET data object to add to the simulation
 *                 example:
 *                   predictions:
 *                     - property: "logP"
 *                       value: 2.3
 *                     - property: "solubility"
 *                       value: "moderate"
 *                   figure_1: "<div>...</div>"
 *                   timestamp: "2025-09-12T10:30:00Z"
 *             required:
 *               - admet
 *     responses:
 *       200:
 *         description: Simulation updated successfully with ADMET data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Simulation updated with ADMET data successfully"
 *                 simulationKey:
 *                   type: string
 *                 admet:
 *                   type: object
 *                 updatedAt:
 *                   type: string
 *       400:
 *         description: Missing ADMET data or invalid request
 *       404:
 *         description: Simulation not found
 *       500:
 *         description: Server error
 */
app.put('/api/simulation/:simulationKey/admet', ensureMongoConnected, requireAdmetCallbackAuth, async (req, res) => {
  try {
    const { simulationKey } = req.params;
    const { admet } = req.body;
    
    if (!simulationKey) {
      return res.status(400).json({ 
        error: 'Simulation key is required' 
      });
    }
    
    if (!admet || typeof admet !== 'object') {
      return res.status(400).json({ 
        error: 'ADMET data is required and must be a valid JSON object',
        example: {
          admet: {
            predictions: [
              { property: "logP", value: 2.3 },
              { property: "solubility", value: "moderate" }
            ],
            figure_1: "<div>...</div>",
            timestamp: new Date().toISOString()
          }
        }
      });
    }
    
    const simulationLogs = client.db().collection('simulation_logs');
    
    // Check if simulation exists
    const existingSimulation = await simulationLogs.findOne({ simulationKey });
    
    if (!existingSimulation) {
      return res.status(404).json({ 
        error: 'Simulation not found',
        simulationKey 
      });
    }
    
    // Add timestamp to ADMET data if not present
    const admetWithTimestamp = {
      ...admet,
      addedAt: new Date().toISOString()
    };
    
    // Update the simulation with ADMET data
    const updateResult = await simulationLogs.updateOne(
      { simulationKey },
      { 
        $set: { 
          admet: admetWithTimestamp,
          lastUpdated: new Date().toISOString()
        }
      }
    );
    
    if (updateResult.matchedCount === 0) {
      return res.status(404).json({ 
        error: 'Simulation not found',
        simulationKey 
      });
    }
    
    res.json({
      message: 'Simulation updated with ADMET data successfully',
      simulationKey,
      admet: admetWithTimestamp,
      updatedAt: new Date().toISOString(),
      modifiedCount: updateResult.modifiedCount
    });
    
  } catch (error) {
    console.error('Error updating simulation with ADMET data:', error);
    res.status(500).json({ 
      error: 'Failed to update simulation with ADMET data', 
      details: error.message,
      simulationKey: req.params.simulationKey
    });
  }
});

/**
 * @swagger
 * /api/simulation/{simulationKey}/admet:
 *   get:
 *     summary: Get ADMET data for a specific simulation
 *     tags: [Simulations]
 *     parameters:
 *       - in: path
 *         name: simulationKey
 *         required: true
 *         schema:
 *           type: string
 *         description: Simulation key to retrieve ADMET data for
 *     responses:
 *       200:
 *         description: ADMET data for the simulation
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 simulationKey:
 *                   type: string
 *                 admet:
 *                   type: object
 *                 hasAdmet:
 *                   type: boolean
 *       404:
 *         description: Simulation not found or no ADMET data available
 *       500:
 *         description: Server error
 */
app.get('/api/simulation/:simulationKey/admet', ensureMongoConnected, authenticateToken, requireActiveUser, async (req, res) => {
  try {
    const { simulationKey } = req.params;
    
    if (!simulationKey) {
      return res.status(400).json({ 
        error: 'Simulation key is required' 
      });
    }
    
    const simulationLogs = client.db().collection('simulation_logs');
    
    const tenantFilter = buildTenantFilter(req.user);

    // Find the simulation and project only ADMET-related fields
    const simulation = await simulationLogs.findOne(
      { simulationKey, ...tenantFilter },
      { 
        projection: { 
          simulationKey: 1, 
          admet: 1, 
          pdbid: 1, 
          smiles: 1,
          lastUpdated: 1 
        } 
      }
    );
    
    if (!simulation) {
      return res.status(404).json({ 
        error: 'Simulation not found',
        simulationKey 
      });
    }

    // If ADMET data is not present, create a RabbitMQ task for processing
    if (!simulation.admet) {
      try {
        console.log(`No ADMET data found for simulation ${simulationKey}, creating RabbitMQ task...`);
        
        const taskResult = await createAdmetTask({
          simulationKey: simulation.simulationKey,
          smiles: simulation.smiles ? simulation.smiles.split(',').map(smile => `"${smile.trim()}"`) : [],
          pdbid: simulation.pdbid,
          userId: req.user.username || 'system',
          priority: 'normal'
        });
        
        console.log('ADMET task created successfully:', taskResult);
        
        return res.json({
          simulationKey: simulation.simulationKey,
          pdbid: simulation.pdbid,
          smiles: simulation.smiles,
          admet: null,
          hasAdmet: false,
          lastUpdated: simulation.lastUpdated,
          processing: {
            status: 'queued',
            message: 'ADMET prediction task has been queued for processing',
            taskId: taskResult.taskId,
            estimatedTime: taskResult.estimatedProcessingTime
          }
        });
        
      } catch (rabbitmqError) {
        console.error('Failed to create ADMET task:', rabbitmqError);
        
        // Still return the simulation data even if RabbitMQ task creation fails
        return res.json({
          simulationKey: simulation.simulationKey,
          pdbid: simulation.pdbid,
          smiles: simulation.smiles,
          admet: null,
          hasAdmet: false,
          lastUpdated: simulation.lastUpdated,
          processing: {
            status: 'error',
            message: 'Failed to queue ADMET prediction task',
            error: rabbitmqError.message
          }
        });
      }
    }

    res.json({
      simulationKey: simulation.simulationKey,
      pdbid: simulation.pdbid,
      smiles: simulation.smiles,
      admet: simulation.admet || null,
      hasAdmet: !!simulation.admet,
      lastUpdated: simulation.lastUpdated
    });
    
  } catch (error) {
    console.error('Error retrieving ADMET data for simulation:', error);
    res.status(500).json({ 
      error: 'Failed to retrieve ADMET data for simulation', 
      details: error.message,
      simulationKey: req.params.simulationKey
    });
  }
});

/**
 * @swagger
 * /api/simulation/{simulationKey}/admet:
 *   delete:
 *     summary: Remove ADMET data from a simulation
 *     tags: [Simulations]
 *     parameters:
 *       - in: path
 *         name: simulationKey
 *         required: true
 *         schema:
 *           type: string
 *         description: Simulation key to remove ADMET data from
 *     responses:
 *       200:
 *         description: ADMET data removed successfully
 *       404:
 *         description: Simulation not found
 *       500:
 *         description: Server error
 */
app.delete('/api/simulation/:simulationKey/admet', ensureMongoConnected, authenticateToken, requireActiveUser, async (req, res) => {
  try {
    const { simulationKey } = req.params;
    
    if (!simulationKey) {
      return res.status(400).json({ 
        error: 'Simulation key is required' 
      });
    }
    
    const simulationLogs = client.db().collection('simulation_logs');
    
    const tenantFilter = buildTenantFilter(req.user);

    // Remove ADMET data from the simulation
    const updateResult = await simulationLogs.updateOne(
      { simulationKey, ...tenantFilter },
      { 
        $unset: { admet: "" },
        $set: { lastUpdated: new Date().toISOString() }
      }
    );
    
    if (updateResult.matchedCount === 0) {
      return res.status(404).json({ 
        error: 'Simulation not found',
        simulationKey 
      });
    }
    
    res.json({
      message: 'ADMET data removed from simulation successfully',
      simulationKey,
      removedAt: new Date().toISOString(),
      modifiedCount: updateResult.modifiedCount
    });
    
  } catch (error) {
    console.error('Error removing ADMET data from simulation:', error);
    res.status(500).json({ 
      error: 'Failed to remove ADMET data from simulation', 
      details: error.message,
      simulationKey: req.params.simulationKey
    });
  }
});

/**
 * @swagger
 * /api/rabbitmq/health:
 *   get:
 *     summary: Check RabbitMQ connection health
 *     tags: [Email]
 *     responses:
 *       200:
 *         description: RabbitMQ health status
 *       500:
 *         description: RabbitMQ connection error
 */
app.get('/api/rabbitmq/health', ensureMongoConnected, authenticateToken, requireCompanyAdmin, async (req, res) => {
  try {
    const healthStatus = await rabbitMQHealthCheck();
    
    if (healthStatus.status === 'healthy') {
      res.json(healthStatus);
    } else {
      res.status(503).json(healthStatus);
    }
  } catch (error) {
    res.status(500).json({
      status: 'error',
      connected: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @swagger
 * /api/rabbitmq/queue-status:
 *   get:
 *     summary: Get ADMET processing queue status
 *     tags: [Email]
 *     responses:
 *       200:
 *         description: Queue status information
 *       500:
 *         description: Error getting queue status
 */
app.get('/api/rabbitmq/queue-status', ensureMongoConnected, authenticateToken, requireCompanyAdmin, async (req, res) => {
  try {
    const queueStatus = await getQueueStatus();
    res.json(queueStatus);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get queue status',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @swagger
 * /api/admet/create-task:
 *   post:
 *     summary: Manually create ADMET processing task
 *     tags: [Simulations]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               simulationKey:
 *                 type: string
 *               smiles:
 *                 type: string
 *               pdbid:
 *                 type: string
 *               priority:
 *                 type: string
 *                 enum: [low, normal, high]
 *             required:
 *               - simulationKey
 *               - smiles
 *     responses:
 *       200:
 *         description: ADMET task created successfully
 *       400:
 *         description: Missing required parameters
 *       500:
 *         description: Failed to create task
 */
app.post('/api/admet/create-task', ensureMongoConnected, authenticateToken, requireActiveUser, async (req, res) => {
  try {
    const { simulationKey, smiles, pdbid, priority = 'normal' } = req.body;
    
    if (!simulationKey || !smiles) {
      return res.status(400).json({
        error: 'simulationKey and smiles are required',
        received: { simulationKey, smiles, pdbid, priority }
      });
    }
    
    const taskResult = await createAdmetTask({
      simulationKey,
      smiles,
      pdbid,
      userId: req.user.username,
      priority
    });
    
    res.json({
      message: 'ADMET task created successfully',
      ...taskResult,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error creating manual ADMET task:', error);
    res.status(500).json({
      error: 'Failed to create ADMET task',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Simple append log function
const MAX_LOG_SIZE = 20 * 1024 * 1024; // 20 MB
const LOG_PATH = 'diffdock_api.log';

function logToFile(logStr) {
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] ${logStr}\n`;
  try {
    // Check log file size
    if (fs.existsSync(LOG_PATH)) {
      const stats = fs.statSync(LOG_PATH);
      if (stats.size + Buffer.byteLength(entry) > MAX_LOG_SIZE) {
        // If file exceeds max size, delete old log and start new
        fs.unlinkSync(LOG_PATH);
      }
    }
    fs.appendFile(LOG_PATH, entry, err => {
      if (err) console.error('Failed to write log:', err);
    });
  } catch (err) {
    console.error('Log rotation error:', err);
  }
}

// Serve built frontend files before the SPA route fallback.
app.use(express.static(FRONTEND_DIST_PATH, { index: false }));

// SPA fallback for non-API routes when frontend build is present
app.get(/^(?!\/(?:api|api-docs|health|tanimoto|blobs)(?:\/|$)).*/, (req, res, next) => {
  if (!hasFrontendBuild()) {
    return next();
  }
  return res.sendFile(FRONTEND_INDEX_PATH);
});

// Start the server after all routes are registered
startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
