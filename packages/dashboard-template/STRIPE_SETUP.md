# Stripe Integration Setup

This project includes Stripe payment integration for subscription plans.

## Environment Setup

1. **Copy the environment template:**
   ```bash
   cp .env.example .env
   ```

2. **Get your Stripe API keys:**
   - Go to [Stripe Dashboard](https://dashboard.stripe.com/apikeys)
   - Copy your **Publishable key** (starts with `pk_test_` or `pk_live_`)
   - Copy your **Secret key** (starts with `sk_test_` or `sk_live_`)

3. **Update your .env file:**
   ```env
   VITE_STRIPE_PUBLISHABLE_KEY=pk_test_your_actual_publishable_key_here
   STRIPE_SECRET_KEY=sk_test_your_actual_secret_key_here
   ```

## Running the Application

1. **Start the Stripe server:**
   ```bash
   npm run stripe-server
   ```

2. **Start the React development server (in another terminal):**
   ```bash
   npm run dev
   ```

3. **Navigate to the pricing page:**
   Open `http://localhost:5173/dashboard/paidplans`

## Security Notes

- ⚠️ **Never commit `.env` files to version control**
- ✅ The `.env` file is already added to `.gitignore`
- ✅ Use test keys (`pk_test_` and `sk_test_`) for development
- ✅ Use live keys (`pk_live_` and `sk_live_`) only in production

## Payment Flow

1. User selects a plan on the pricing page
2. Client sends request to `/create-checkout-session` endpoint
3. Server creates Stripe checkout session
4. User is redirected to Stripe's secure checkout page
5. After payment, user is redirected back with success/cancel status

## Testing

Use Stripe's test card numbers:
- **Success:** `4242 4242 4242 4242`
- **Decline:** `4000 0000 0000 0002`
- Use any future expiry date and any 3-digit CVC
