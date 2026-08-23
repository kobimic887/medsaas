import { useEffect, useRef, useState } from "react";
import {
  Card,
  CardBody,
  Typography,
  Button,
  Alert,
  Spinner,
} from "@material-tailwind/react";
import { CheckIcon, XMarkIcon, CheckCircleIcon } from "@heroicons/react/24/outline";
import { API_CONFIG, getAuthToken } from "@/utils/constants";
import { TOKEN_PLANS } from "@/utils/tokenPlans";

export function PaidPlans() {
  const [loadingPlan, setLoadingPlan] = useState('');
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState(''); // 'success' or 'error'
  const requestControllerRef = useRef(null);

  // Check for payment success/cancel from URL params
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('success')) {
      setMessage('Checkout completed. Stripe is confirming the payment; credits appear after the signed webhook is received.');
      setMessageType('success');
    } else if (urlParams.get('canceled')) {
      setMessage('Payment was canceled. You can try again anytime.');
      setMessageType('error');
    }

    if (urlParams.has('success') || urlParams.has('canceled') || urlParams.has('session_id')) {
      urlParams.delete('success');
      urlParams.delete('canceled');
      urlParams.delete('session_id');
      const remainingQuery = urlParams.toString();
      window.history.replaceState(
        {},
        document.title,
        `${window.location.pathname}${remainingQuery ? `?${remainingQuery}` : ''}`,
      );
    }

    return () => requestControllerRef.current?.abort();
  }, []);

  const plans = TOKEN_PLANS;

  const handlePlanSelection = async (plan) => {
    const controller = new AbortController();
    requestControllerRef.current?.abort();
    requestControllerRef.current = controller;
    setLoadingPlan(plan.name);
    setMessage('');

    try {
      if (plan.name === 'Trial') {
        await claimTrialTokens(controller.signal);
        return;
      }

      const result = await createCheckoutSession(plan, controller.signal);
      if (!result.url) throw new Error('Checkout did not return a redirect URL');
      window.location.assign(result.url);
    } catch (error) {
      if (error.name === 'AbortError') return;
      setMessage(`Failed to start checkout: ${error.message}`);
      setMessageType('error');
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
        setLoadingPlan('');
      }
    }
  };

  const createCheckoutSession = async (plan, signal) => {
    const token = getAuthToken();
    const response = await fetch(API_CONFIG.buildUrl('/create-checkout-session-onetime'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ planName: plan.name }),
      signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || 'Failed to create checkout session');
    }
    return payload;
  };

  const claimTrialTokens = async (signal) => {
    try {
      const token = getAuthToken();
      const response = await fetch(API_CONFIG.buildApiUrl('/billing/claim-trial'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Failed to claim trial tokens');
      }
      setMessage(`Trial activated. ${data.credits} simulation tokens were added.`);
      setMessageType('success');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      setMessage(error.message);
      setMessageType('error');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-12 dark:bg-slate-950">
      <div className="max-w-7xl mx-auto">
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
          <Typography variant="h1" className="mb-4 text-4xl font-bold text-gray-900 dark:text-slate-50 lg:text-5xl">
            Choose Your Plan
          </Typography>
          <Typography variant="lead" className="mx-auto mb-8 max-w-3xl text-xl text-gray-600 dark:text-slate-400">
            Elevate your molecular research without breaking the bank! Our pricing options make 
            advanced computational tools accessible to every researcher and scientist.
          </Typography>
          

        </div>

        {/* Pricing Cards */}
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
          {plans.map((plan) => (
            <div key={plan.name} className="relative">
              <Card className="h-full shadow-lg transition-all duration-300 hover:shadow-xl dark:border dark:border-slate-800 dark:bg-slate-900">
                <CardBody className="p-8">
                  <div className="text-center mb-8">
                    <Typography variant="h4" className="mb-2 font-bold text-gray-900 dark:text-slate-100">
                      {plan.name}
                    </Typography>
                    <Typography className="mb-6 text-gray-600 dark:text-slate-300">
                      {plan.subtitle}
                    </Typography>
                    
                    <div className="mb-4">
                      <div className="flex items-baseline justify-center">
                        <Typography variant="h2" className="text-4xl font-bold text-gray-900 dark:text-slate-100">
                          {plan.price ? `$${plan.price}` : 'Free'}
                        </Typography>
                        {plan.price ? (
                          <Typography className="ml-1 text-gray-500 dark:text-slate-400">one-time</Typography>
                        ) : null}
                      </div>

                    </div>
                    
                    <Typography className="mb-6 text-sm text-gray-600 dark:text-slate-300">
                      {plan.description}
                    </Typography>
                  </div>

                  <div className="space-y-4 mb-8">
                    {plan.features.map((feature, idx) => (
                      <div key={idx} className="flex items-start gap-3">
                        <CheckIcon className="h-5 w-5 text-green-500 mt-0.5 flex-shrink-0" />
                        <Typography className="text-sm text-gray-700 dark:text-slate-200">
                          {feature}
                        </Typography>
                      </div>
                    ))}
                  </div>
                  <Button
                    onClick={() => handlePlanSelection(plan)}
                    aria-label={plan.name === 'Trial' ? 'Claim Trial credits' : `Purchase ${plan.name} credit pack`}
                    color={plan.buttonColor}
                    size="lg"
                    className="w-full"
                    variant="outlined"
                    disabled={Boolean(loadingPlan)}
                  >
                    {loadingPlan === plan.name ? (
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
          <Typography className="mb-4 text-gray-600 dark:text-slate-400">
            Start free with the Trial plan, then buy credit packs as you need them. Credits are added automatically after payment.
          </Typography>
          <Typography className="text-sm text-gray-500 dark:text-slate-400">
            Questions about our plans? <a href="mailto:sales@asinex.com?subject=Plan%20inquiry" className="text-blue-600 hover:underline dark:text-blue-300">Contact our sales team</a>
          </Typography>
        </div>
      </div>
    </div>
  );
}

export default PaidPlans;
