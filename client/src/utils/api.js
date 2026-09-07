// Utility functions for API calls
import { APP_BASE_PATH } from "./appEnv";

const explicitApiBase = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/$/, '');

/**
 * API base URL for browser requests.
 * Default: same-origin. On the normal build that is the root ("") so Vite dev
 * proxy and the unified production deploy work without setting
 * VITE_API_HOSTNAME / port. On the isolated staging build it is "/staging", so
 * requests stay inside the staging nginx scope ("no staging request may silently
 * fall through to the production API") and nginx forwards them to the staging
 * server. Set VITE_API_BASE_URL only for split hosting.
 */
export const getApiBaseUrl = () => {
  if (explicitApiBase) {
    return explicitApiBase;
  }
  return APP_BASE_PATH;
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
