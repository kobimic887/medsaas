import { createCheckoutSession, getCheckoutSession } from '../api/stripe.js';

export default function handler(req, res) {
  if (req.method === 'POST' && req.url === '/api/create-checkout-session') {
    return handleCreateCheckoutSession(req, res);
  }
  
  if (req.method === 'GET' && req.url.startsWith('/api/checkout-session/')) {
    return handleGetCheckoutSession(req, res);
  }
  
  res.status(404).json({ error: 'Not found' });
}

async function handleCreateCheckoutSession(req, res) {
  try {
    const { planName, price, isYearly } = req.body;
    const origin = req.headers.origin || 'http://localhost:5173';
    
    const result = await createCheckoutSession(planName, price, isYearly, origin);
    res.json(result);
  } catch (error) {
    console.error('Error creating checkout session:', error);
    res.status(500).json({ error: error.message });
  }
}

async function handleGetCheckoutSession(req, res) {
  try {
    const sessionId = req.url.split('/').pop();
    const session = await getCheckoutSession(sessionId);
    res.json(session);
  } catch (error) {
    console.error('Error retrieving session:', error);
    res.status(500).json({ error: error.message });
  }
}
