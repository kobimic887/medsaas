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


export function PaidPlansDescription() {
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
      setMessage('Payment received! Your subscription is now active.');
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
      monthlyPrice: null,
      yearlyPrice: null,
      popular: false,
      description: 'Affordable access for anyone to understand the concept',
      features: [
        'Trial',
        '4 tokens',        
        'Low job priority',
        'Most models & settings',
        'Email Support',
        'Guaranteed Confidentiality',
      ],
      buttonText: 'Register To Try',
      buttonColor: 'gray'
    },
    {
      name: 'Budget',
      subtitle: 'Affordable access for students and researchers',
      monthlyPrice: 6.42,
      yearlyPrice: 77.04,
      popular: false,
      description: 'Affordable access for students and researchers with light computational needs.',
      features: [
        'Academic Use',
        '84 tokens/year',
        '7 parallel jobs',
        'Low job priority',
        'Most models & settings',
        'Email Support',
        'Guaranteed Confidentiality',
        'Unlimited Data Storage',
        'Full Pipelines Access',
        'Full API Access',
        'Max 5k Residues Protein Folding',
        'Access to Molecular Dynamics',
        'Folding Simulation Not Included'
      ],
      buttonText: 'Purchase',
      buttonColor: 'blue-gray'
    },
    {
      name: 'Standard',
      subtitle: 'Best for active research projects',
      monthlyPrice: 12.08,
      yearlyPrice: 144.96,
      popular: false,
      description: 'The best choice for active research projects needing more power.',
      features: [
        'Academic Use',
        '168 tokens/year',
        '14 parallel jobs',
        'Medium job priority',
        'Most models & settings',
        'Email Support',
        'Guaranteed Confidentiality',
        'Unlimited Data Storage',
        'Full Pipelines Access',
        'Full API Access',
        'Max 5k Residues Protein Folding',
        'Access to Molecular Dynamics',
        'Folding Simulation Not Included'
      ],
      buttonText: 'Purchase',
      buttonColor: 'blue'
    },
    {
      name: 'Academic',
      subtitle: 'For serious academic research',
      monthlyPrice: 21.25,
      yearlyPrice: 255.00,
      popular: true,
      description: 'Designed for serious academic research with higher compute demands.',
      features: [
        'Academic Use',
        '300 tokens/year',
        '30 parallel jobs',
        'Medium job priority',
        'Most models & settings',
        'Preferred Support',
        'Guaranteed Confidentiality',
        'Unlimited Data Storage',
        'Full Pipelines Access',
        'Full API Access',
        'Max 5k Residues Protein Folding',
        'Access to Molecular Dynamics',
        'Folding Simulation Not Included'
      ],
      buttonText: 'Purchase',
      buttonColor: 'indigo'
    },
    {
      name: 'Professional',
      subtitle: 'The powerhouse plan for professionals',
      monthlyPrice: 66.67,
      yearlyPrice: 800.04,
      popular: false,
      description: 'The powerhouse plan for professionals needing large-scale computation.',
      features: [
        'Commercial Use',
        '720 tokens/year',
        '60 parallel jobs',
        'High job priority',
        'All models & settings',
        'Priority Support',
        'Guaranteed Confidentiality',
        'Unlimited Data Storage',
        'Full Pipelines Access',
        'Full API Access',
        'Max 5k Residues Protein Folding',
        'Access to Molecular Dynamics',
        'Folding Simulation Not Included'
      ],
      buttonText: 'Purchase',
      buttonColor: 'purple'
    },
    {
      name: 'Enterprise',
      subtitle: 'Custom solutions for businesses and large-scale projects',
      monthlyPrice: null,
      yearlyPrice: null,
      popular: false,
      description: 'Commercial use rights, unlimited users, unlimited parallel jobs, custom models/pipelines/visualizations. Contact for pricing.',
      features: [
        'Commercial Use',
        'Unlimited users',
        'Unlimited parallel jobs',
        'Custom models, pipelines, visualizations',
        'Pyxis-discovery Teams',
        'Contact for pricing'
      ],
      buttonText: 'Contact Us',
      buttonColor: 'gray'
    }
  ];  const handlePlanSelection = async (plan) => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setMessage('Please register first, and then choose the plan on the dashboard');


  };

  // Helper function to create checkout session
  const createCheckoutSession = async (plan, isYearly) => {
    try {
      const response = await fetch(`https://${window.location.hostname}:3000/create-checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          planName: plan.name,
          price: isYearly ? plan.yearlyPrice : plan.monthlyPrice,
          isYearly: isYearly,
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

  return (
    <div className="about-us-page min-h-screen bg-gray-50 py-5 px-4">
      <div className="container max-w-7xl mx-auto">
        {/* Stripe Configuration Error */}
        {!isStripeConfigured && (
          <div className="mb-8">
            <div className="alert alert-danger d-flex align-items-center" role="alert">
              <span className="fw-bold me-2">Stripe Not Configured</span>
              <span>
                Stripe payment integration is not properly configured. Please check the STRIPE_SETUP.md file for setup instructions.
              </span>
            </div>
          </div>
        )}

        {/* Success/Error Messages */}
        {message && (
          <div className="mb-8">
            <div className={`alert ${messageType === 'success' ? 'alert-success' : 'alert-danger'} d-flex align-items-center`} role="alert">
              <span className="fw-bold me-2">{messageType === 'success' ? 'Success:' : 'Error:'}</span>
              <span>{message}</span>
              <button type="button" className="btn-close ms-auto" aria-label="Close" onClick={() => setMessage('')}></button>
            </div>
          </div>
        )}

        {/* Header Section */}
        <div className="text-center mb-16">
          <h1 className="display-3 fw-bold mb-4">Choose Your Plan</h1>
          <p className="lead mb-8 text-xl text-gray-600 max-w-3xl mx-auto">
            Elevate your molecular research without breaking the bank! Our pricing options make 
            advanced computational tools accessible to every researcher and scientist.
          </p>
          {/* Billing Toggle */}
          <div className="d-flex align-items-center justify-content-center gap-4 mb-12">
            <span className={`fs-5 fw-medium ${!isYearly ? 'text-primary' : 'text-secondary'}`}>Billed Monthly</span>
            <div className="form-check form-switch mx-3">
              <input className="form-check-input" type="checkbox" id="billingToggle" checked={isYearly} onChange={handleToggleChange} />
              <label className="form-check-label" htmlFor="billingToggle"></label>
            </div>
            <span className={`fs-5 fw-medium ${isYearly ? 'text-primary' : 'text-secondary'}`}>Billed Yearly</span>
            <span className="badge bg-success ms-2">Save up to 20%</span>
          </div>
        </div>

        {/* Pricing Cards */}
        <div className="row g-4 max-w-7xl mx-auto">
          {plans.map((plan, index) => (
            <div key={index} className="col-lg-4 col-md-6 col-12">
              <div className={`card h-100 ${plan.popular ? 'border-primary shadow-lg scale-105' : 'shadow-sm'} transition-all duration-300`}>
                {plan.popular && (
                  <span className="badge bg-primary position-absolute top-0 start-50 translate-middle-x mt-2">Most Popular</span>
                )}
                <div className="card-body p-4 text-center">
                  <h4 className="fw-bold mb-2 text-dark">{plan.name}</h4>
                  <p className="text-secondary mb-3">{plan.subtitle}</p>
                  <div className="mb-4">
                    <div className="d-flex align-items-baseline justify-content-center">
                      <span className="display-6 fw-bold text-dark">${isYearly ? plan.yearlyPrice : plan.monthlyPrice}</span>
                      <span className="text-muted ms-2">/{isYearly ? 'year' : 'month'}</span>
                    </div>
                    {isYearly && plan.yearlyPrice && plan.monthlyPrice && (
                      <div className="text-success small mt-1">
                        Save ${((plan.monthlyPrice * 12) - plan.yearlyPrice).toFixed(0)}/year
                      </div>
                    )}
                  </div>
                  <p className="text-secondary small mb-4">{plan.description}</p>
                  <ul className="list-unstyled mb-4">
                    {plan.features.map((feature, idx) => (
                      <li key={idx} className="d-flex align-items-center mb-2">
                        <span className="badge bg-success me-2">✓</span>
                        <span className="text-dark small">{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={() => handlePlanSelection(plan)}
                    className={`btn btn-lg w-100 fw-bold ${plan.popular ? 'btn-primary' : plan.buttonColor === 'gray' ? 'btn-secondary' : `btn-${plan.buttonColor}`}`}
                    disabled={loading}
                  >
                    {loading ? (
                      <>
                        <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                        Processing...
                      </>
                    ) : (
                      plan.buttonText
                    )}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Additional Info Section */}
        <div className="mt-5 text-center">
          <p className="text-secondary mb-2">
            All plans include a 14-day free trial. No credit card required to start.
          </p>
          <p className="text-muted small">
            Questions about our plans? <a href="#" className="text-primary text-decoration-underline">Contact our sales team</a>
          </p>
        </div>
      </div>
    </div>
  );
}

export default PaidPlansDescription;