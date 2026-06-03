import https from 'https';
import fs from 'fs';
import axios from 'axios';
import { execFile } from 'child_process';
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import FormData from 'form-data';
import { MongoClient } from 'mongodb';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';
import 'dotenv/config';
import { configDotenv } from 'dotenv';
import Stripe from 'stripe';
import nodemailer from 'nodemailer';
import path from 'path';
import { fileURLToPath } from 'url';

// Import email templates
import { generateVerificationEmailHTML, generateWelcomeEmailHTML, generatePasswordResetEmailHTML } from './utils/emailTemplates.js';
import { sendTitanEmail, testEmailConfiguration } from './utils/emailService.js';
import { validateEmailCredentials, getTitanMailHelp } from './utils/emailDebug.js';
import { createAdmetTask, getQueueStatus, rabbitMQHealthCheck } from './utils/rabbitMQUtils.js';

// Load environment variables
configDotenv();

// Validate Stripe configuration
if (!process.env.STRIPE_SECRET_KEY) {
  console.error('ERROR: STRIPE_SECRET_KEY environment variable is not set');
  console.error('Please create a .env file with your Stripe secret key');
  process.exit(1);
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const app = express();
app.use(express.json());
app.use(cors());

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
app.post('/api/generate-molecules', async (req, res) => {
  const { smi, min_similarity, num_molecules } = req.body;
  const invoke_url = 'https://health.api.nvidia.com/v1/biology/nvidia/molmim/generate';
  const headers = {
    'Authorization': 'Bearer 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',
    'Accept': 'application/json',
  };
  const payload = {
    algorithm: 'CMA-ES',
    num_molecules: num_molecules || 30,
    property_name: 'QED',
    minimize: false,
    min_similarity: min_similarity || 0.3,
    particles: 30,
    iterations: 10,
    smi: smi || '[H][C@@]12Cc3c[nH]c4cccc(C1=C[C@H](NC(=O)N(CC)CC)CN2C)c34',
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
app.post("/api/openfold3/predict", async (req, res) => {
  const invoke_url =
    "https://health.api.nvidia.com/v1/biology/openfold/openfold3/predict";
  const headers = {
    Authorization:
      "Bearer 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",
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

// Add a redirect from root to API docs
app.get('/', (req, res) => {
  res.redirect('/api-docs');
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
        url: 'https://app.pyxis-discovery.com:3000',
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

// Add a test route to verify routing is working
app.get('/test', (req, res) => {
  res.json({ message: 'Test route working', timestamp: new Date().toISOString() });
});

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/yourdbname';
const client = new MongoClient(uri);
let usersCollection;

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
    
    // Create indexes if they don't exist
    try {
      await usersCollection.createIndex({ username: 1 }, { unique: true });
      await usersCollection.createIndex({ email: 1 }, { unique: true });
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

// Configure nodemailer transporter for Gmail
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  }
});
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
app.post('/create-checkout-session-onetime', async (req, res) => {
  try {
    const { planName, price, description, totalAmount } = req.body;

    const productName = (typeof description === 'string' && description.trim())
      ? description.trim()
      : (typeof planName === 'string' && planName.trim() ? planName.trim() : null);

    let amount = (totalAmount !== undefined && totalAmount !== null) ? totalAmount : price;
    if (typeof amount === 'string') amount = parseFloat(amount);

    if (!productName || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        error: 'Invalid request body',
        details: 'Provide either { description, totalAmount } or { planName, price } with a positive amount.'
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
      success_url: `${req.headers.origin}/dashboard/paidplans?success=true&session_id={CHECKOUT_SESSION_ID}&plan=${encodeURIComponent(productName)}`,
      cancel_url: `${req.headers.origin}/dashboard/paidplans?canceled=true`,
      metadata: {
        product: productName,
        type: 'onetime',
        sourceFields: description !== undefined || totalAmount !== undefined ? 'description/totalAmount' : 'planName/price'
      }
    });
    res.json({ url: session.url });
  } catch (error) {
    console.error('Error creating one-time checkout session:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create checkout session endpoint
app.post('/create-checkout-session', async (req, res) => {
  try {
    const { planName, price, isYearly } = req.body;
    
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${planName} Plan`,
              description: `${planName} subscription for molecular research tools`,
            },
            unit_amount: Math.round(price * 100), // Convert to cents
            recurring: {
              interval: isYearly ? 'year' : 'month',
            },
          },
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${req.headers.origin}/dashboard/paidplans?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin}/dashboard/paidplans?canceled=true`,
      metadata: {
        plan: planName,
        billing: isYearly ? 'yearly' : 'monthly'
      }
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get session details endpoint
app.get('/checkout-session/:sessionId', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
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
app.post('/api/signup', ensureMongoConnected, async (req, res) => {
  const { username, password, email, phoneNumber, shippingAddress, billingAddress } = req.body;
  if (!username || !password || !email) return res.status(400).json({ error: 'Username, password, and email required' });
  // Password policy: min 8 chars, at least 1 uppercase, 1 lowercase, 1 digit, 1 special char
  const passwordPolicy = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/;
  if (!passwordPolicy.test(password)) {
    return res.status(400).json({ error: 'Password must be at least 8 characters and include uppercase, lowercase, digit, and special character.' });
  }
  const existing = await usersCollection.findOne({ $or: [{ username }, { email }] });
  if (existing) return res.status(409).json({ error: 'User or email already exists' });
  const hash = await bcrypt.hash(password, 10);
  // Optional fields cleanup
  const cleanedPhone = typeof phoneNumber === 'string' && phoneNumber.trim() ? phoneNumber.trim() : undefined;
  const cleanedShipping = typeof shippingAddress === 'string' && shippingAddress.trim() ? shippingAddress.trim() : undefined;
  const cleanedBilling = typeof billingAddress === 'string' && billingAddress.trim() ? billingAddress.trim() : undefined;

  const insertDoc = { username, email, password: hash, verified: false };
  if (cleanedPhone) insertDoc.phoneNumber = cleanedPhone;
  if (cleanedShipping) insertDoc.shippingAddress = cleanedShipping;
  if (cleanedBilling) insertDoc.billingAddress = cleanedBilling;

  await usersCollection.insertOne(insertDoc);

  // Send verification email using helper
  const verificationToken = jwt.sign({ username, email }, process.env.JWT_SECRET || 'secret', { expiresIn: '1d' });
  const verificationUrl = `${process.env.BASE_URL || 'https://app.pyxis-discovery.com'}:3000/api/verify-email?token=${verificationToken}`;
  
  try {
    // Generate HTML email template
    const htmlContent = generateVerificationEmailHTML(username, verificationUrl);
    
    await sendTitanEmail({
      name: username,
      subject: 'Verify Your Email - Pyxis Discovery',
      message: `Welcome to Pyxis Discovery ${username}! \n\nPlease verify your email by clicking the following link: ${verificationUrl}`,
      recipientEmail: email,
      htmlContent: htmlContent
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to send verification email', details: err.message });
  }

  res.json({ message: 'Signup successful. Please check your email to verify your account.' });
});

app.get('/api/verify-email', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send('Invalid verification link');
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    const { email, username } = decoded;
    await usersCollection.updateOne({ email }, { $set: { verified: true } });
    
    // Send success HTML page
    const successHTML = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Email Verified - Pyxis Discovery</title>
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
            <div class="logo">PYXIS DISCOVERY</div>
            <div class="success-icon">✓</div>
            <h1>Email Verified Successfully!</h1>
            <p>Welcome to Pyxis Discovery, ${username || 'User'}! Your email has been verified and your account is now active.</p>
            <p>You can now access all features of our molecular research platform.</p>
            <a href="https://app.pyxis-discovery.com/auth/sign-in" class="login-button">Sign In to Your Account</a>
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
        <title>Verification Error - Pyxis Discovery</title>
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
app.post('/api/signin', ensureMongoConnected, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const user = await usersCollection.findOne({ username });
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  if (!user.verified) return res.status(403).json({ error: 'Email not verified. Please check your email.' });
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ username }, process.env.JWT_SECRET || 'secret', { expiresIn: '1d' });
  res.json({ message: 'Signin successful', token });
});

app.get('/api/hello', (req, res) => {
  res.send('{"data":"hello"}');
});

app.post('/api/data', (req, res) => {
  res.json({ message: 'POST request received!', received: req.body });
});

// Test endpoint to check if user exists (for debugging)
app.get('/api/test-user/:username', ensureMongoConnected, async (req, res) => {
  try {
    const { username } = req.params;
    const user = await usersCollection.findOne({ username }, { projection: { password: 0 } });
    
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
      filter = {
        $or: [
          { ASINEX_ID: { $regex: search, $options: 'i' } },
          { IUPAC_NAME: { $regex: search, $options: 'i' } },
          { SMILES_STRING: { $regex: search, $options: 'i' } },
           { INCHI: { $regex: search, $options: 'i' } },
           { INCHIKEY: { $regex: search, $options: 'i' } },
          { BRUTTO_FORMULA: { $regex: search, $options: 'i' } }
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
      filter = {
        $or: [
          { ASINEX_ID: { $regex: query, $options: 'i' } },
          { IUPAC_NAME: { $regex: query, $options: 'i' } },
          { INCHI: { $regex: query, $options: 'i' } },
          { INCHIKEY: { $regex: query, $options: 'i' } },
          { SMILES_STRING: { $regex: query, $options: 'i' } },
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
      filter.BRUTTO_FORMULA = { $regex: formula, $options: 'i' };
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

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  jwt.verify(token, process.env.JWT_SECRET || 'secret', (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
}

app.post('/api/shop', authenticateToken, async (req, res) => {
  try {
    const response = await fetch('https://stock.asinex.com:5443/api/Shop', {
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



app.get('/api/simulation', ensureMongoConnected, authenticateToken, async (req, res) => {
  const { pdbid, smiles } = req.query;
  if (!pdbid || !smiles) {
    return res.status(400).json({ error: 'pdbid and smiles are required as query parameters' });
  }
  try {
    const simulationLogs = client.db().collection('simulation_logs');
    // Check if simulation already exists for this user, pdbid, and smiles
    const existing = await simulationLogs.findOne({
      //'user.username': req.user.username,
      pdbid,
      smiles
    });
    if (existing) {
      return res.json({ ...existing.result, simulationKey: existing.simulationKey });
    }
    // Check and subtract simulationTokens
    const userDoc = await usersCollection.findOne({ username: req.user.username });
    if (!userDoc || typeof userDoc.simulationTokens !== 'number' || userDoc.simulationTokens <= 0) {
      return res.status(403).json({ error: 'No simulation tokens left' });
    }
    if(userDoc.name!=="tester123")
      await usersCollection.updateOne(
        { username: req.user.username },
        { $inc: { simulationTokens: -1 } }
      );
    // Generate a 12-character random key
    const simulationKey = Array.from({length: 12}, () =>
      Math.random().toString(36).charAt(2)
    ).join('');
    // Call external API
    const url = `https://services.asinex.com:8000/docking/${encodeURIComponent(pdbid)}&${encodeURIComponent(smiles)}`;
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
      user: req.user, // Store the full decoded JWT payload
      pdbid,
      smiles,
      result: data,
      simulationKey,
      timestamp: new Date()
    });
    res.json({ ...data, simulationKey });
  } catch (error) {
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
app.post('/api/simulation', ensureMongoConnected, authenticateToken, async (req, res) => {
  const { pdbid, smiles } = req.body;
  if (!pdbid || !smiles) {
    return res.status(400).json({ error: 'pdbid and smiles are required in request body' });
  }
  try {
    const simulationLogs = client.db().collection('simulation_logs');
    // Check if simulation already exists for this user, pdbid, and smiles
    const existing = await simulationLogs.findOne({
      //'user.username': req.user.username,
      pdbid,
      smiles
    });
    if (existing) {
      return res.json({ ...existing.result, simulationKey: existing.simulationKey });
    }
    // Check and subtract simulationTokens
    const userDoc = await usersCollection.findOne({ username: req.user.username });
    if (!userDoc || typeof userDoc.simulationTokens !== 'number' || userDoc.simulationTokens <= 0) {
      return res.status(403).json({ error: 'No simulation tokens left' });
    }
    await usersCollection.updateOne(
      { username: req.user.username },
      { $inc: { simulationTokens: -1 } }
    );
    // Generate a 12-character random key
    const simulationKey = Array.from({length: 12}, () =>
      Math.random().toString(36).charAt(2)
    ).join('');
    // Call external API with POST method
    const response = await fetch('https://services.asinex.com:8000/docking', {
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
      user: req.user, // Store the full decoded JWT payload
      pdbid,
      smiles,
      result: data,
      simulationKey,
      timestamp: new Date(),
      method: 'POST'
    });
    res.json({ ...data, simulationKey });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/simulation-logs', ensureMongoConnected, authenticateToken, async (req, res) => {
  try {
    const simulationLogs = client.db().collection('simulation_logs');
    // Only return logs for the authenticated user
    const logs = await simulationLogs.find({ 'user.username': req.user.username }).sort({ timestamp: -1 }).toArray();
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/sanitizedpdb/:simulationKey',  async (req, res) => {
  const { simulationKey } = req.params;
  try {
    const simulationLogs = client.db().collection('simulation_logs');
    // Find simulation by simulationKey
    const existing = await simulationLogs.findOne({ simulationKey });
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
app.get('/api/sanitizedsdf/:simulationKey',  async (req, res) => {
  const { simulationKey } = req.params;
  try {
    const simulationLogs = client.db().collection('simulation_logs');
    // Find simulation by simulationKey
    const existing = await simulationLogs.findOne({ simulationKey });
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
app.get('/api/sanitizedminimalsdf/:simulationKey',  async (req, res) => {
 const { simulationKey } = req.params;
  try {
    const simulationLogs = client.db().collection('simulation_logs');
    // Find simulation by simulationKey
    const existing = await simulationLogs.findOne({ simulationKey });
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
app.get('/api/sanitizedspecificsdf/:simulationKey/:smiles',  async (req, res) => {
 const { simulationKey, smiles } = req.params;
  try {
    const simulationLogs = client.db().collection('simulation_logs');
    // Find simulation by simulationKey
    const existing = await simulationLogs.findOne({ simulationKey });
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
  jwt.verify(token, process.env.JWT_SECRET || 'secret', async (err, decoded) => {
    if (err || !decoded || !decoded.username) return res.json({ valid: false, error: 'Invalid token' });
    const user = await usersCollection.findOne({ username: decoded.username }, { projection: { password: 0 } });
    if (!user) return res.json({ valid: false, error: 'User not found' });
    res.json({ valid: true, user });
  });
});

// Direct Asinex API Proxy Endpoints
const ASINEX_API_BASE = 'http://dev.asinex.com:58181';

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
app.get('/api/exact/:smiles', async (req, res) => {
  try {
    const { smiles } = req.params;
    
    if (!smiles) {
      return res.status(400).json({ error: 'SMILES string is required' });
    }
    
    // Forward the request directly to Asinex API
    const response = await fetch(`${ASINEX_API_BASE}/api/exact/${smiles}`, {
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
    
    res.status(response.status);
    
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
app.get('/api/all/:id_:pageSize', async (req, res) => {
  try {
    const { id, pageSize } = req.params;
    
    // Forward the request directly to Asinex API
    const response = await fetch(`${ASINEX_API_BASE}/api/all/${id}_${pageSize}`, {
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
    
    res.status(response.status);
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
app.get('/api/id/:id_number', async (req, res) => {
  try {
    const { id_number } = req.params;
    
    // Forward the request directly to Asinex API
    const response = await fetch(`${ASINEX_API_BASE}/api/id/${id_number}`, {
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
    
    res.status(response.status);
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
app.post('/api/api4/bas', async (req, res) => {
  try {
    const response = await fetch(`${ASINEX_API_BASE}/api4/bas`, {
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

    res.status(response.status);
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
app.post('/api/api4/structure', async (req, res) => {
  try {
    const response = await fetch(`${ASINEX_API_BASE}/api4/structure`, {
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

    res.status(response.status);
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
app.post('/api/api4/substructure', async (req, res) => {
  try {
    const response = await fetch(`${ASINEX_API_BASE}/api4/substructure`, {
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

    res.status(response.status);
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
app.post('/api/api4/similarity', async (req, res) => {
  try {
    const response = await fetch(`${ASINEX_API_BASE}/api4/similarity`, {
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

    res.status(response.status);
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
app.post('/api/api4/mw', async (req, res) => {
  try {
    const response = await fetch(`${ASINEX_API_BASE}/api4/mw`, {
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

    res.status(response.status);
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
app.post('/api/diffdock/generate', async (req, res) => {
  try {
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
          const sdfResponse = await fetch('http://83.229.87.94:8001/convertSTR', {
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
      const response = await fetch('https://services.asinex.com:58000/molecular-docking/diffdock/generate', {
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

    res.status(response.status);
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
app.post('/api/diffdock/generate_file', async (req, res) => {
  try {
    const { protein, ligand } = req.body;

    if (!protein || !ligand) {
      return res.status(400).json({ error: 'protein and ligand are required' });
    }

    // Execute the diff_dock.sh script with protein and ligand parameters
    execFile('./diff_dock.sh', [protein, ligand], { cwd: process.cwd() }, (error, stdout, stderr) => {
      if (error) {
        console.error('Script execution error:', error);
        console.error('stderr:', stderr);
        return res.status(500).json({ 
          error: 'Failed to execute DiffDock script', 
          details: error.message,
          stderr: stderr
        });
      }

      // Read the output.json file
      const outputPath = path.join(process.cwd(), 'output.json');
      fs.readFile(outputPath, 'utf8', (readError, data) => {
        if (readError) {
          console.error('File read error:', readError);
          return res.status(500).json({ 
            error: 'Failed to read output.json file', 
            details: readError.message 
          });
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
          res.status(500).json({ 
            error: 'Failed to parse output.json file', 
            details: parseError.message 
          });
        }
      });
    });
  } catch (error) {
    console.error('DiffDock script API error:', error);
    res.status(500).json({ error: 'Failed to execute DiffDock script', details: error.message });
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
app.get('/api/asinex/all/:id_:pageSize', async (req, res) => {
  try {
    const { id_, pageSize } = req.params;
    
    if (!id_ || !pageSize ) {
      return res.status(400).json({ error: '_id, pageSize are all required' });
    }

    const response = await fetch(`${ASINEX_API_BASE}/api/all/${id_}_${pageSize.replace('_', '')}`, {
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
app.get('/api/asinex/id/:id_number', async (req, res) => {
  try {
    const { id_number } = req.params;
    
    if (!id_number) {
      return res.status(400).json({ error: 'id_number is required' });
    }
    
    const response = await fetch(`${ASINEX_API_BASE}/api/id/${encodeURIComponent(id_number)}`, {
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
app.get('/api/asinex/exact/:smiles', async (req, res) => {
  try {
    const { smiles } = req.params;
    
    if (!smiles) {
      return res.status(400).json({ error: 'SMILES string is required' });
    }
    
    const response = await fetch(`${ASINEX_API_BASE}/api/exact/${encodeURIComponent(smiles)}`, {
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
app.get('/api/asinex/substructure/:id_:pageSize/:smiles', async (req, res) => {
  try {
    const { id_, pageSize, smiles } = req.params;
    
    if (!id_ || !pageSize || !smiles) {
      return res.status(400).json({ error: '_id, pageSize, and SMILES are all required' });
    }
  let uri =`${ASINEX_API_BASE}/api/substructure/${id_}_${pageSize.replace('_', '')}/${encodeURIComponent(smiles)}`;
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
app.post('/api/asinex/search', async (req, res) => {
  try {
    const { searchType, id, pageSize, id_number, smiles } = req.body;
    
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
        apiUrl = `${ASINEX_API_BASE}/api/all/${id}_${pageSize}`;
        searchParams = { id, pageSize };
        break;
        
      case 'id':
        if (!id_number) {
          return res.status(400).json({ error: 'id_number is required for ID search' });
        }
        apiUrl = `${ASINEX_API_BASE}/api/id/${encodeURIComponent(id_number)}`;
        searchParams = { id_number };
        break;
        
      case 'exact':
        if (!smiles) {
          return res.status(400).json({ error: 'smiles is required for exact search' });
        }
        apiUrl = `${ASINEX_API_BASE}/api/exact/${encodeURIComponent(smiles)}`;
        searchParams = { smiles };
        break;
        
      case 'substructure':
        if (!id || !pageSize || !smiles) {
          return res.status(400).json({ error: 'id, pageSize, and smiles are required for substructure search' });
        }
        apiUrl = `${ASINEX_API_BASE}/api/substructure/${id}_${pageSize}/${encodeURIComponent(smiles)}`;
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
app.get('/api/asinex/health', async (req, res) => {
  try {
    const response = await fetch(`${ASINEX_API_BASE}/api/all/1_1`, {
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
        baseUrl: ASINEX_API_BASE,
        statusCode: response.status,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    res.json({
      asinexApi: {
        status: 'unhealthy',
        baseUrl: ASINEX_API_BASE,
        error: error.message,
        timestamp: new Date().toISOString()
      }
    });
  }
});

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
    const httpsOptions = {
      key: fs.readFileSync('/etc/letsencrypt/live/app.pyxis-discovery.com/privkey.pem'),
      cert: fs.readFileSync('/etc/letsencrypt/live/app.pyxis-discovery.com/fullchain.pem')
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

// Start the server
startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

// Serve blobs statically
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use('/blobs', express.static(path.join(__dirname, 'blobs')));

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
app.post('/api/issueSimulationTokens', ensureMongoConnected, authenticateToken, async (req, res) => {
  try {
    const username = req.user.username;
    if (!username) return res.status(400).json({ error: 'No username in token' });
    // Get amount from request body, default to 50
    const amount = typeof req.body.simulationTokens === 'number' && req.body.simulationTokens > 0 ? req.body.simulationTokens : 50;
    const result = await usersCollection.updateOne(
      { username },
      { $set: { simulationTokens: amount } },
      { upsert: true }
    );
    res.json({ message: `simulationTokens set to ${amount}`, result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Test email configuration endpoint
app.get('/api/test-email', async (req, res) => {
  const result = await testEmailConfiguration();
  if (result.success) {
    res.json(result);
  } else {
    res.status(500).json(result);
  }
});

// Email credentials debugging endpoint
app.get('/api/debug-email', (req, res) => {
  const validation = validateEmailCredentials();
  const help = getTitanMailHelp();
  
  res.json({
    validation,
    help,
    timestamp: new Date().toISOString()
  });
});

// Send test email endpoint
app.post('/api/send-test-email', async (req, res) => {
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
      subject: 'Test Email from Pyxis Discovery', 
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
 *                 example: "Welcome to Pyxis Discovery"
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
app.post('/api/send-email', async (req, res) => {
  try {
    const { name, subject, message, recipientEmail } = req.body;
    if (!name || !subject || !message || !recipientEmail) {
      return res.status(400).json({ 
        success: false, 
        error: 'All fields including recipient email are required' 
      });
    }
    await sendTitanEmail({ name, subject, message, recipientEmail });
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
app.post('/api/projects', ensureMongoConnected, authenticateToken, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Project name is required' });
  try {
    const projectsCollection = client.db().collection('projects');
    const project = {
      name,
      userid: req.user.username, // or req.user.id if you use a numeric id
      createdAt: new Date()
    };
    const result = await projectsCollection.insertOne(project);
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
app.get('/api/activity', ensureMongoConnected, authenticateToken, async (req, res) => {
  try {
    const db = client.db();
    // Get latest registered users
    const users = await db.collection('users')
      .find({}, { projection: { username: 1, email: 1, createdAt: 1 } })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();
    // Get latest opened projects
    const projects = await db.collection('projects')
      .find({}, { projection: { name: 1, userid: 1, createdAt: 1 } })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();
    // Get latest executed simulations
    const simulations = await db.collection('simulation_logs')
      .find({}, { projection: { pdbid: 1, smiles: 1, user: 1, timestamp: 1, simulationKey: 1 } })
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
      filter.$or = [
        { ASINEX_ID: { $regex: search, $options: 'i' } },
        { IUPAC_NAME: { $regex: search, $options: 'i' } },
        { SMILES_STRING: { $regex: search, $options: 'i' } },
        { BRUTTO_FORMULA: { $regex: search, $options: 'i' } }
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
        SMILES_STRING: { $regex: pattern, $options: 'i' } 
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
app.put('/api/simulation/:simulationKey/admet', ensureMongoConnected, async (req, res) => {
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
app.get('/api/simulation/:simulationKey/admet', ensureMongoConnected, async (req, res) => {
  try {
    const { simulationKey } = req.params;
    
    if (!simulationKey) {
      return res.status(400).json({ 
        error: 'Simulation key is required' 
      });
    }
    
    const simulationLogs = client.db().collection('simulation_logs');
    
    // Find the simulation and project only ADMET-related fields
    const simulation = await simulationLogs.findOne(
      { simulationKey },
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
          userId: 'system', // You can modify this to use actual user ID if available
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
app.delete('/api/simulation/:simulationKey/admet', ensureMongoConnected, async (req, res) => {
  try {
    const { simulationKey } = req.params;
    
    if (!simulationKey) {
      return res.status(400).json({ 
        error: 'Simulation key is required' 
      });
    }
    
    const simulationLogs = client.db().collection('simulation_logs');
    
    // Remove ADMET data from the simulation
    const updateResult = await simulationLogs.updateOne(
      { simulationKey },
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
app.get('/api/rabbitmq/health', async (req, res) => {
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
app.get('/api/rabbitmq/queue-status', async (req, res) => {
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
app.post('/api/admet/create-task', async (req, res) => {
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
      userId: 'manual',
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