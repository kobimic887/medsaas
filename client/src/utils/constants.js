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

// Decode a JWT payload without verifying the signature (client-side only — used
// purely to read `exp` so we don't mount authed pages with an already-dead token).
export const decodeTokenPayload = (token) => {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
};

// True if a token exists and its `exp` is in the future (with a small skew margin).
export const hasValidToken = () => {
  const payload = decodeTokenPayload(getAuthToken());
  if (!payload || typeof payload.exp !== 'number') return false;
  // 10s skew so a token that's about to expire is treated as already dead.
  return payload.exp * 1000 > Date.now() + 10_000;
};

// Remove every auth-related key. Mirrors AuthContext.logout() for use outside React.
export const clearAuthStorage = () => {
  localStorage.removeItem('user_info');
  localStorage.removeItem('access_token');
  localStorage.removeItem('auth_token');
  localStorage.removeItem('user'); // legacy key
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
