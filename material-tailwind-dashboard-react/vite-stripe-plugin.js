import Stripe from 'stripe';

export function stripeApiPlugin() {
  return {
    name: 'stripe-api',
    configureServer(server) {
      // Load environment variables
      const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
      
      if (!stripeSecretKey) {
        console.error('ERROR: STRIPE_SECRET_KEY environment variable is not set');
        return;
      }

      const stripe = new Stripe(stripeSecretKey);

      server.middlewares.use('/api/create-checkout-session', async (req, res, next) => {
        if (req.method !== 'POST') {
          return next();
        }

        let body = '';
        req.on('data', chunk => {
          body += chunk.toString();
        });

        req.on('end', async () => {
          try {
            const { planName, price, isYearly } = JSON.parse(body);
            
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
              success_url: `${req.headers.origin || 'http://localhost:5173'}/dashboard/paidplans?success=true&session_id={CHECKOUT_SESSION_ID}`,
              cancel_url: `${req.headers.origin || 'http://localhost:5173'}/dashboard/paidplans?canceled=true`,
              metadata: {
                plan: planName,
                billing: isYearly ? 'yearly' : 'monthly'
              }
            });

            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            res.end(JSON.stringify({ url: session.url }));
          } catch (error) {
            console.error('Error creating checkout session:', error);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: error.message }));
          }
        });
      });

      server.middlewares.use('/api/checkout-session', async (req, res, next) => {
        if (req.method !== 'GET') {
          return next();
        }

        const urlParts = req.url.split('/');
        const sessionId = urlParts[urlParts.length - 1];

        if (!sessionId) {
          res.statusCode = 400;
          res.end('Session ID required');
          return;
        }

        try {
          const session = await stripe.checkout.sessions.retrieve(sessionId);
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.end(JSON.stringify(session));
        } catch (error) {
          console.error('Error retrieving session:', error);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: error.message }));
        }
      });
    }
  };
}
