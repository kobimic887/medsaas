const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');
const http = require('http');
const fs = require('fs');
const nodemailer = require('nodemailer');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Validate Stripe configuration
if (!process.env.STRIPE_SECRET_KEY) {
  console.error('ERROR: STRIPE_SECRET_KEY environment variable is not set');
  console.error('Please create a .env file with your Stripe secret key');
  process.exit(1);
}

// Check if Stripe secret key is available
if (!process.env.STRIPE_SECRET_KEY) {
  console.error('ERROR: STRIPE_SECRET_KEY environment variable is not set');
  console.error('Please create a .env file with your Stripe secret key');
  console.error('Current working directory:', process.cwd());
  console.error('Looking for .env at:', path.join(__dirname, '.env'));
  process.exit(1);
}

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();

app.use(cors());
app.use(express.json());

// Create checkout session endpoint (for subscriptions)
app.post('/api/create-checkout-session', async (req, res) => {
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

// Create checkout session for one-time payment (paid plans and molecule cart)
app.post('/create-checkout-session-onetime', async (req, res) => {
  try {
    const { planName, price, cartItems, totalAmount, description } = req.body;
    
    let lineItems = [];
    let successUrl = '';
    let cancelUrl = '';
    let metadata = {};

    // Handle molecule cart checkout
    if (cartItems && cartItems.length > 0) {
      lineItems = cartItems.map(item => ({
        price_data: {
          currency: 'usd',
          product_data: {
            name: item.name || 'Molecule',
            description: `${item.amount}mg - ${item.smiles ? item.smiles.substring(0, 50) : 'Chemical compound'}`,
          },
          unit_amount: Math.round((item.totalPrice || item.price || 0) * 100), // Convert to cents
        },
        quantity: 1,
      }));
      
      successUrl = `${req.headers.origin}/dashboard/simulation?payment=success`;
      cancelUrl = `${req.headers.origin}/dashboard/simulation?payment=canceled`;
      metadata = {
        type: 'molecule_purchase',
        itemCount: cartItems.length,
        totalAmount: totalAmount.toFixed(2)
      };
    } 
    // Handle plan purchase
    else if (planName && price) {
      lineItems = [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${planName} Plan`,
              description: `One-time payment for ${planName} credits`,
            },
            unit_amount: Math.round(price * 100), // Convert to cents
          },
          quantity: 1,
        },
      ];
      
      successUrl = `${req.headers.origin}/dashboard/paidplans?success=true&plan=${planName}`;
      cancelUrl = `${req.headers.origin}/dashboard/paidplans?canceled=true`;
      metadata = {
        plan: planName,
        type: 'one_time_purchase'
      };
    } else {
      return res.status(400).json({ error: 'Invalid request: must provide either planName/price or cartItems' });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: metadata
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('Error creating one-time checkout session:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create checkout session for one-time payment (molecule purchase)
app.post('/create-checkout-session-molecules', async (req, res) => {
  try {
    const { cartItems, totalAmount, description } = req.body;
    
    if (!cartItems || cartItems.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    // Create line items from cart
    const lineItems = cartItems.map(item => ({
      price_data: {
        currency: 'usd',
        product_data: {
          name: item.name || 'Molecule',
          description: `${item.amount}mg - ${item.smiles ? item.smiles.substring(0, 50) : 'Chemical compound'}`,
        },
        unit_amount: Math.round((item.totalPrice || item.price || 0) * 100), // Convert to cents
      },
      quantity: 1,
    }));

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: `${req.headers.origin}/dashboard/simulation?payment=success`,
      cancel_url: `${req.headers.origin}/dashboard/simulation?payment=canceled`,
      metadata: {
        type: 'molecule_purchase',
        itemCount: cartItems.length,
        totalAmount: totalAmount.toFixed(2)
      }
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('Error creating molecule checkout session:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get session details endpoint
app.get('/api/checkout-session/:sessionId', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
    res.json(session);
  } catch (error) {
    console.error('Error retrieving session:', error);
    res.status(500).json({ error: error.message });
  }
});

// Issue simulation tokens endpoint
app.post('/api/issueSimulationTokens', async (req, res) => {
  try {
    const { simulationTokens } = req.body;
    
    if (!simulationTokens || typeof simulationTokens !== 'number') {
      return res.status(400).json({ error: 'Invalid simulation tokens amount' });
    }

    // In a real application, you would:
    // 1. Verify the user's authentication token
    // 2. Update the database with the new token count
    // 3. Return the updated token count
    
    // For now, we'll just return a success response
    // The client will handle updating localStorage
    res.json({ 
      success: true, 
      tokens: simulationTokens,
      message: 'Simulation tokens issued successfully'
    });
    
  } catch (error) {
    console.error('Error issuing simulation tokens:', error);
    res.status(500).json({ error: error.message });
  }
});

// Test email configuration endpoint
app.get('/api/test-email', async (req, res) => {
  try {
    console.log('Testing Titan Mail configuration...');
    
    // Official Titan Mail configuration
    const config = {
      host: 'smtp.titan.email',
      port: 465,
      secure: true, // SSL/TLS for port 465
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      }
    };

    const transporter = nodemailer.createTransport(config);
    await transporter.verify();
    
    res.json({ 
      success: true, 
      message: 'Email configuration is working correctly!',
      config: 'Titan Mail SSL 465'
    });
    
  } catch (error) {
    console.error('Email test failed:', error.message);
    
    let troubleshooting = [];
    if (error.message.includes('authentication failed')) {
      troubleshooting = [
        'Log into Titan Webmail at https://app.titan.email/',
        'Go to Settings > Enable Titan on other apps',
        'Complete the feature tour and enable third-party access',
        'Disable Two-Factor Authentication if enabled',
        'Verify your email and password are correct'
      ];
    }
    
    res.status(500).json({ 
      success: false, 
      error: error.message,
      troubleshooting: troubleshooting,
      credentials: {
        user: process.env.EMAIL_USER ? 'SET' : 'NOT SET',
        pass: process.env.EMAIL_PASS ? 'SET' : 'NOT SET'
      }
    });
  }
});

// Email sending endpoint
app.post('/api/send-email', async (req, res) => {
  try {
    const { name, subject, message, recipientEmail } = req.body;

    // Validate required fields
    if (!name || !subject || !message || !recipientEmail) {
      return res.status(400).json({ 
        success: false, 
        error: 'All fields including recipient email are required' 
      });
    }

    // Official Titan Mail configuration from documentation
    const config = {
      host: 'smtp.titan.email',
      port: 465,
      secure: true, // SSL/TLS for port 465
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      }
    };

    const transporter = nodemailer.createTransport(config);

    // Email content
    const mailOptions = {
      from: process.env.EMAIL_FROM,
      to: recipientEmail,
      subject: `${subject}`,
      html: `
        <h2>Message from ${name}</h2>
        <p><strong>From:</strong> ${name} (via ${process.env.EMAIL_FROM})</p>
        <p><strong>Subject:</strong> ${subject}</p>
        <p><strong>Message:</strong></p>
        <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 10px 0;">
          ${message.replace(/\n/g, '<br>')}
        </div>
        <hr>
        <p style="color: #666; font-size: 12px;">
          This email was sent from ${process.env.EMAIL_FROM} via the email client.
        </p>
      `,
      text: `
        Message from ${name}
        
        From: ${name} (via ${process.env.EMAIL_FROM})
        Subject: ${subject}
        
        Message:
        ${message}
        
        ---
        This email was sent from ${process.env.EMAIL_FROM} via the email client.
      `
    };

    await transporter.sendMail(mailOptions);
    res.json({ success: true, message: 'Email sent successfully' });
    
  } catch (error) {
    console.error('Email sending error:', error);
    
    let errorMessage = 'Failed to send email. ';
    if (error.message.includes('authentication failed')) {
      errorMessage += 'Please check: 1) Third-party email access is enabled in your Titan account, 2) Two-Factor Authentication is disabled, 3) Credentials are correct.';
    } else {
      errorMessage += 'Please try again later.';
    }
    
    res.status(500).json({ 
      success: false, 
      error: errorMessage
    });
  }
});

const PORT = process.env.PORT || 3001;

// Use HTTP for local development, HTTPS for production
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction) {
  // Production HTTPS setup
  try {
    const httpsOptions = {
      key: fs.readFileSync('/etc/letsencrypt/live/chem.software/privkey.pem'),
      cert: fs.readFileSync('/etc/letsencrypt/live/chem.software/fullchain.pem')
    };
    https.createServer(httpsOptions, app).listen(PORT, '0.0.0.0', () => {
      console.log(`cjs Stripe HTTPS server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('HTTPS certificates not found, falling back to HTTP');
    http.createServer(app).listen(PORT, '0.0.0.0', () => {
      console.log(`cjs Stripe HTTP server running on port ${PORT} (fallback)`);
    });
  }
} else {
  // Development HTTP setup
  http.createServer(app).listen(PORT, '0.0.0.0', () => {
    console.log(`cjs Stripe HTTP server running on port ${PORT} (development)`);
  });
}
