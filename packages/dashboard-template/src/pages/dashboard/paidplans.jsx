import React, { useState, useEffect } from "react";
import {
  Card,
  CardBody,
  Typography,
  Button,
  Switch,
  Chip,
  Alert,
  Spinner,
} from "@material-tailwind/react";
import { CheckIcon, XMarkIcon, CheckCircleIcon } from "@heroicons/react/24/outline";
import { loadStripe } from '@stripe/stripe-js';

// Initialize Stripe
const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

export function PaidPlans() {
  const [isYearly, setIsYearly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState(''); // 'success' or 'error'

  // Check if Stripe is properly configured
  const isStripeConfigured = !!import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

  // Handle toggle change
  const handleToggleChange = () => {
    const newValue = !isYearly;
    console.log('Toggle changed from', isYearly, 'to', newValue);
    setIsYearly(newValue);
  };

  // Check for payment success/cancel from URL params
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('success')) {
      const planName = urlParams.get('plan');
      const selectedPlan = plans.find(p => p.name === planName);
      const credits = selectedPlan?.credits || 50;
      issueSimulationTokens(credits);
      setMessage('Payment received! Your have successfully subscribed to the plan: ' + planName);
      setMessageType('success');
    } else if (urlParams.get('canceled')) {
      setMessage('Payment was canceled. You can try again anytime.');
      setMessageType('error');
    }
  }, []);

  const plans = [
     {
      name: 'Trial',
      subtitle: 'Affordable access for anyone to understand the concept',
      popular: false,
      description: 'Affordable access for anyone to understand the concept',
      credits: 4,
      features: [
        'Trial',
        '4 credits',        
        'Low job priority',
        'Most models & settings',
        'Email Support',
        'Guaranteed Confidentiality',
      ],
      buttonText: 'Get Tokens and Try',
      buttonColor: 'gray'
    },
    {
      name: 'Standard',
      subtitle: 'Best for active research projects',
      price: 20,
      popular: false,
      description: 'The best choice for active research projects needing more power.',
      credits: 50,
      features: [
        '50 credits',
        'Medium job priority',
        'Most models & settings',
        'Email Support',
        'Guaranteed Confidentiality',
        'Unlimited Data Storage',
      ],
      buttonText: 'Purchase',
      buttonColor: 'blue'
    },
    {
      name: 'Academic',
      subtitle: 'For serious academic research with higher compute demands',
      price: 40,
      popular: false,
      description: 'The best choice for active research projects needing more power.',
      credits: 300,
      features: [
        '300 credits',
        'Medium job priority',
        'Most models & settings',
        'Email Support',
        'Guaranteed Confidentiality',
        'Unlimited Data Storage',
      ],
      buttonText: 'Purchase',
      buttonColor: 'blue'
    },
    
    {
      name: 'Professional',
      subtitle: 'The powerhouse plan for professionals',
      price: 80,
      popular: false,
      description: 'The powerhouse plan for professionals needing large-scale computation.',
      credits: 720,
      features: [
        'Commercial Use',
        '720 credits',
        'High job priority',
        'All models & settings',
        'Priority Support',
        'Guaranteed Confidentiality',
        'Unlimited Data Storage',
      ],
      buttonText: 'Purchase',
      buttonColor: 'purple'
    }
  ];  const handlePlanSelection = async (plan) => {
    // Check if Stripe is configured
    if (!isStripeConfigured) {
      setMessage('Stripe is not configured. Please check the setup instructions.');
      setMessageType('error');
      return;
    }

    if (plan.name === 'Trial') {
      // Handle trial
      issueSimulationTokens(plan.credits);
      setMessage('Your subscription is now active.');
      setMessageType('success');
      return;
    }
    if (plan.name === 'Enterprise') {
      // Handle enterprise contact separately
      window.open('mailto:sales@asinex.com?subject=Enterprise Plan Inquiry&body=I am interested in the Enterprise plan for molecular research tools.');
      return;
    }
    setLoading(true);
    setMessage('');

    try {
      const result = await createCheckoutSession(plan, isYearly);
      
      if (result.error) {
        throw new Error(result.error);
      }

      // Redirect to checkout
      window.location.href = result.url;
      
    } catch (error) {
      console.error('Error:', error);
      setMessage(`Failed to start checkout: ${error.message}`);
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  };

  // Helper function to create checkout session
  const createCheckoutSession = async (plan, isYearly) => {
    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`https://${window.location.hostname}:3000/create-checkout-session-onetime`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          planName: plan.name,
          price: plan.price,
      
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create checkout session');
      }

      return await response.json();
    } catch (error) {
      console.error('Error creating checkout session:', error);
      return { error: error.message };
    }
  };

  // Helper to issue simulation tokens after payment
  const issueSimulationTokens = async (tokensAmount) => {
    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`https://${window.location.hostname}:3000/api/issueSimulationTokens`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ simulationTokens: tokensAmount })
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to issue simulation tokens');
      }
      const data = await response.json();
      localStorage.setItem("simulation_tokens", JSON.stringify(tokensAmount));
      console.log('Simulation tokens issued:', data);
      // Scroll to top so user sees the message
      window.scrollTo({ top: 0, behavior: 'smooth' });
      // Dispatch custom event to update tokens in dashboard navbar
      if (data && typeof data.tokens === 'number') {
        window.dispatchEvent(new CustomEvent('tokensUpdated', { detail: { tokens: data.tokens } }));
      }
      // Optionally, show a message or update UI
    } catch (error) {
      console.error('Error issuing simulation tokens:', error);
      // Optionally, show an error message
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-7xl mx-auto">
        {/* Stripe Configuration Error */}
        {!isStripeConfigured && (
          <div className="mb-8">
            <Alert
              color="red"
              icon={<XMarkIcon className="h-5 w-5" />}
            >
              <div>
                <Typography className="font-semibold mb-2">Stripe Not Configured</Typography>
                <Typography className="text-sm">
                  Stripe payment integration is not properly configured. Please check the STRIPE_SETUP.md file for setup instructions.
                </Typography>
              </div>
            </Alert>
          </div>
        )}

        {/* Success/Error Messages */}
        {message && (
          <div className="mb-8">
            <Alert
              color={messageType === 'success' ? 'green' : 'red'}
              icon={messageType === 'success' ? <CheckCircleIcon className="h-5 w-5" /> : <XMarkIcon className="h-5 w-5" />}
              onClose={() => setMessage('')}
              dismissible
            >
              {message}
            </Alert>
          </div>
        )}

        {/* Header Section */}
        <div className="text-center mb-16">
          <Typography variant="h1" className="mb-4 text-4xl lg:text-5xl font-bold text-gray-900">
            Choose Your Plan
          </Typography>
          <Typography variant="lead" className="mb-8 text-xl text-gray-600 max-w-3xl mx-auto">
            Elevate your molecular research without breaking the bank! Our pricing options make 
            advanced computational tools accessible to every researcher and scientist.
          </Typography>
          

        </div>

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-7xl mx-auto">
          {plans.map((plan, index) => (
            <div key={index} className="relative">
              {plan.popular && (
                <div className="absolute -top-4 left-1/2 transform -translate-x-1/2 z-10">
                  <Chip
                    value="Most Popular"
                    className="bg-blue-600 text-white font-semibold px-4 py-2"
                  />
                </div>
              )}
              
              <Card className={`h-full ${plan.popular ? 'ring-2 ring-blue-600 shadow-xl scale-105' : 'shadow-lg hover:shadow-xl'} transition-all duration-300`}>
                <CardBody className="p-8">
                  <div className="text-center mb-8">
                    <Typography variant="h4" className="mb-2 font-bold text-gray-900">
                      {plan.name}
                    </Typography>
                    <Typography className="text-gray-600 mb-6">
                      {plan.subtitle}
                    </Typography>
                    
                    <div className="mb-4">
                      <div className="flex items-baseline justify-center">
                        <Typography variant="h2" className="text-4xl font-bold text-gray-900">
                          ${ plan.price}
                        </Typography>

                      </div>
                
                    </div>
                    
                    <Typography className="text-gray-600 text-sm mb-6">
                      {plan.description}
                    </Typography>
                  </div>

                  <div className="space-y-4 mb-8">
                    {plan.features.map((feature, idx) => (
                      <div key={idx} className="flex items-start gap-3">
                        <CheckIcon className="h-5 w-5 text-green-500 mt-0.5 flex-shrink-0" />
                        <Typography className="text-gray-700 text-sm">
                          {feature}
                        </Typography>
                      </div>
                    ))}
                  </div>                  <Button
                    onClick={() => handlePlanSelection(plan)}
                    color={plan.buttonColor}
                    size="lg"
                    className="w-full"
                    variant={plan.popular ? "filled" : "outlined"}
                    disabled={loading}
                  >
                    {loading ? (
                      <div className="flex items-center justify-center">
                        <Spinner className="h-4 w-4 mr-2" />
                        Processing...
                      </div>
                    ) : (
                      plan.buttonText
                    )}
                  </Button>
                </CardBody>
              </Card>
            </div>
          ))}
        </div>

        {/* Additional Info Section */}
        <div className="mt-16 text-center">
          <Typography className="text-gray-600 mb-4">
            All plans include a 14-day free trial. No credit card required to start.
          </Typography>
          <Typography className="text-gray-500 text-sm">
            Questions about our plans? <a href="#" className="text-blue-600 hover:underline">Contact our sales team</a>
          </Typography>
        </div>
      </div>
    </div>
  );
}

export default PaidPlans;