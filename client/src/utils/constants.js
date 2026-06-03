// API Configuration Constants
import {
  getApiBaseUrl,
  API_HOSTNAME as RESOLVED_API_HOSTNAME,
  API_PORT as RESOLVED_API_PORT,
} from './api.js';

// Utility function to check if running on localhost
export const isLocalhost = () => {
  return window.location.hostname === 'localhost' || 
         window.location.hostname === '127.0.0.1' || 
         window.location.hostname === '::1';
};

// Utility function to get auth token
export const getAuthToken = () => {
  // Try both token names
  return localStorage.getItem('access_token') || localStorage.getItem('auth_token');
};

export const API_CONFIG = {
  hostname: RESOLVED_API_HOSTNAME,
  port: RESOLVED_API_PORT,
  
  // Helper function to build API URLs using the existing api utility
  buildApiUrl: (endpoint) => {
    const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const base = getApiBaseUrl();
    return `${base}/api${path}`;
  },

  // Non-/api routes (Stripe checkout, Tanimoto proxy, etc.)
  buildUrl: (endpoint) => {
    const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    return `${getApiBaseUrl()}${path}`;
  },
};

// Individual exports for backward compatibility
export const API_HOSTNAME = RESOLVED_API_HOSTNAME;
export const API_PORT = RESOLVED_API_PORT;
