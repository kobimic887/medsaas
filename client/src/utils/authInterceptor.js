// Global 401 handler.
//
// All API calls in this app use raw `fetch` with a manually-attached bearer
// token. When a token expires the server replies 401 (authentication failure —
// distinct from 403, which is a legitimate authorization failure the user
// should stay logged in for). Rather than retrofit ~20 call sites, we wrap
// window.fetch once at bootstrap: on a same-origin 401 we clear auth state and
// hard-redirect to the sign-in page exactly once.
//
// Why a hard redirect (window.location) and not router navigate(): a full
// reload tears down every mounted dashboard page in one shot, which stops the
// retry/replaceState storm that an expired token triggers. A soft nav would
// leave components mounted and racing.

import { clearAuthStorage } from './constants';

const SIGN_IN_PATH = '/auth/sign-in';
let isRedirecting = false;

function handleAuthFailure() {
  // Guard: /activity and /simulation-logs (and others) can 401 concurrently —
  // we want a single redirect, not one per failed request.
  if (isRedirecting) return;
  // Never bounce while already on an auth page (avoids a redirect loop and
  // avoids reacting to a 401 from the login request itself).
  if (window.location.pathname.startsWith('/auth')) return;
  isRedirecting = true;
  clearAuthStorage();
  window.location.href = SIGN_IN_PATH;
}

// Resolve the request URL from fetch's polymorphic first arg (string | URL | Request).
function requestUrl(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (input && typeof input.url === 'string') return input.url; // Request object
  return '';
}

// Only act on requests to our own origin. Relative URLs ("/api/...") are
// same-origin by definition; absolute URLs are checked against location.origin
// so a 401 from Stripe/RudderStack/etc. can never log the user out.
function isSameOrigin(url) {
  if (!url) return false;
  if (url.startsWith('/')) return true;
  try {
    return new URL(url, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

export function installAuthInterceptor() {
  if (typeof window === 'undefined' || window.__authInterceptorInstalled) return;
  window.__authInterceptorInstalled = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    const response = await originalFetch(input, init);
    // Read status only — never touch the body, or we'd consume the stream the
    // real caller needs to .json()/.text().
    if (response.status === 401 && isSameOrigin(requestUrl(input))) {
      handleAuthFailure();
    }
    return response;
  };
}
