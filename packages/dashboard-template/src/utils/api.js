// Utility functions for API calls

// Centralized hostname constant
export const API_HOSTNAME = 'app.pyxis-discovery.com' //window.location.hostname;

/**
 * Get the appropriate protocol (http/https) based on the current hostname
 * Uses HTTP for localhost and 127.0.0.1 to avoid SSL certificate issues in development
 */
export const getApiProtocol = () => {
  return (API_HOSTNAME === 'localhost' || API_HOSTNAME === '127.0.0.1') ? 'http' : 'https';
};

/**
 * Get the base API URL with the correct protocol
 */
export const getApiBaseUrl = () => {
  const protocol = getApiProtocol();
  return `${protocol}://${API_HOSTNAME}:3000`;
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
