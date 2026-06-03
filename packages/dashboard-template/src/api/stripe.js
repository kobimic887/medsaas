import Stripe from 'stripe';

// Initialize Stripe with secret key from environment
const stripe = new Stripe(import.meta.env.VITE_STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY);

export async function createCheckoutSession(planName, price, isYearly, origin) {
  try {
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
      success_url: `${origin}/dashboard/paidplans?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/dashboard/paidplans?canceled=true`,
      metadata: {
        plan: planName,
        billing: isYearly ? 'yearly' : 'monthly'
      }
    });

    return { url: session.url };
  } catch (error) {
    console.error('Error creating checkout session:', error);
    throw new Error(error.message);
  }
}

export async function getCheckoutSession(sessionId) {
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    return session;
  } catch (error) {
    console.error('Error retrieving session:', error);
    throw new Error(error.message);
  }
}
