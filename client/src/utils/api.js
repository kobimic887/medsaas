// Utility functions for API calls

// Centralized API host/port configuration
export const API_HOSTNAME = (import.meta.env.VITE_API_HOSTNAME || window.location.hostname).trim();
export const API_PORT = (import.meta.env.VITE_API_PORT || '3000').toString().trim();

const isLocalHostName = (host) =>
  host === 'localhost' || host === '127.0.0.1' || host === '::1';

/**
 * Get the appropriate protocol (http/https) based on the current hostname
 * Uses HTTP for localhost to avoid SSL certificate issues in development
 */
export const getApiProtocol = () => {
  if (import.meta.env.VITE_API_PROTOCOL) {
    return import.meta.env.VITE_API_PROTOCOL;
  }
  return isLocalHostName(API_HOSTNAME) ? 'http' : 'https';
};

/**
 * Get the base API URL with the correct protocol
 */
export const getApiBaseUrl = () => {
  const protocol = getApiProtocol();
  const includePort = API_PORT && API_PORT !== '80' && API_PORT !== '443';
  return `${protocol}://${API_HOSTNAME}${includePort ? `:${API_PORT}` : ''}`;
};

/**
 * Make an API request with automatic protocol detection
 */
export const apiRequest = async (endpoint, options = {}) => {
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}${endpoint}`;
  
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
};
