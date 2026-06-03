// Utility functions for API calls

const explicitApiBase = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/$/, '');

/**
 * API base URL for browser requests.
 * Default: same-origin (empty string) so Vite dev proxy and unified production deploy work
 * without setting VITE_API_HOSTNAME / port. Set VITE_API_BASE_URL only for split hosting.
 */
export const getApiBaseUrl = () => {
  if (explicitApiBase) {
    return explicitApiBase;
  }
  if (import.meta.env.DEV) {
    return '';
  }
  return '';
};

export const API_HOSTNAME = explicitApiBase
  ? new URL(explicitApiBase).hostname
  : window.location.hostname;
export const API_PORT = explicitApiBase
  ? new URL(explicitApiBase).port || (new URL(explicitApiBase).protocol === 'https:' ? '443' : '80')
  : window.location.port;

export const getApiProtocol = () => {
  if (explicitApiBase) {
    return new URL(explicitApiBase).protocol.replace(':', '');
  }
  return window.location.protocol.replace(':', '');
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
