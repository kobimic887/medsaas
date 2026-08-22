export const PLAN_CATALOG = Object.freeze({
  Trial: Object.freeze({ displayName: 'Trial', credits: 4, priceCents: 0 }),
  Standard: Object.freeze({ displayName: 'Standard', credits: 50, priceCents: 2000 }),
  Academic: Object.freeze({ displayName: 'Academic', credits: 300, priceCents: 4000 }),
  Professional: Object.freeze({ displayName: 'Professional', credits: 720, priceCents: 8000 }),
});

export function getPlan(planName) {
  if (typeof planName !== 'string') return null;
  return PLAN_CATALOG[planName.trim()] || null;
}

export function buildPlanCheckoutSessionParams({ appUrl, plan, user }) {
  if (!plan || !Number.isSafeInteger(plan.priceCents) || plan.priceCents <= 0) {
    throw new Error('A paid server-side plan is required');
  }
  if (!user?.username) throw new Error('An authenticated user is required');

  const returnBase = String(appUrl || '').replace(/\/$/, '');
  if (!/^https?:\/\//.test(returnBase)) throw new Error('A public application URL is required');

  return {
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: `${plan.displayName} token pack`,
            description: `${plan.credits} simulation tokens`,
          },
          unit_amount: plan.priceCents,
        },
        quantity: 1,
      },
    ],
    mode: 'payment',
    success_url: `${returnBase}/dashboard/paid-plans?success=true&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${returnBase}/dashboard/paid-plans?canceled=true`,
    metadata: {
      purchaseType: 'plan_tokens',
      plan: plan.displayName,
      credits: String(plan.credits),
      username: user.username,
      userId: user.userId || '',
      companyId: user.companyId || '',
      companyName: user.companyName || '',
    },
  };
}
