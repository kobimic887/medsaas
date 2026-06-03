// API Configuration Constants
import { getApiBaseUrl } from './api.js';

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
  hostname: 'app.pyxis-discovery.com',//window.location.hostname,
  port: '3000',
  
  // Helper function to build API URLs using the existing api utility
  buildApiUrl: (endpoint) => {
    return `${getApiBaseUrl()}/api${endpoint}`;
  },
  
  // Helper function to build non-API URLs (like Stripe checkout)
  buildUrl: (endpoint) => {
    return `${getApiBaseUrl()}${endpoint}`;
  }
};

// Individual exports for backward compatibility
export const API_HOSTNAME = API_CONFIG.hostname;
export const API_PORT = API_CONFIG.port;
