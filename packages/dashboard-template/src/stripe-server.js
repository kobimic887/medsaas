import https from 'https';
import fs from 'fs';
import express from 'express';
import cors from 'cors';
import { configDotenv } from 'dotenv';
import Stripe from 'stripe';

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

app.use(cors());
app.use(express.json());

// Create checkout session endpoint
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

const PORT = 3001; // Use a different port to avoid conflicts
const httpsOptions = {
  key: fs.readFileSync('/etc/letsencrypt/live/chem.software/privkey.pem'),
  cert: fs.readFileSync('/etc/letsencrypt/live/chem.software/fullchain.pem')
};
https.createServer(httpsOptions, app).listen(PORT, '0.0.0.0', () => {
  console.log(`js HTTPS Server running on port ${PORT}`);
});