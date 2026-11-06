/* =====================================================================
   FRONTEND AUTH & SESSION GUARD
   Manages tokens, expiration checks, login/logout transitions,
   and route protection for non-auth workspace pages.
   ===================================================================== */

export const AUTH_TOKEN_KEY = 'snapsec_auth_token';
export const AUTH_USER_KEY = 'snapsec_auth_user';

// Set of public route identifiers that do NOT require authentication
export const PUBLIC_AUTH_ROUTES = new Set([
  'login',
  'signup',
  'forgot',
  'forgot-sent',
  'reset',
  'reset-done',
  'verify',
  'onboarding',
  'invite',
]);

export function isPublicAuthRoute(route) {
  if (!route || typeof route !== 'string') return false;
  const clean = route.replace(/^#/, '').trim();
  return PUBLIC_AUTH_ROUTES.has(clean);
}

export function getStoredAuthToken() {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function getStoredAuthUser() {
  try {
    const raw = localStorage.getItem(AUTH_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveAuthSession(token, user, expiresAt) {
  try {
    if (token) localStorage.setItem(AUTH_TOKEN_KEY, String(token));
    if (user) localStorage.setItem(AUTH_USER_KEY, JSON.stringify({ ...user, expiresAt }));
  } catch {
    /* storage blocked */
  }
}

export function clearAuthSession() {
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    localStorage.removeItem('snapsec.v2');
  } catch {
    /* storage blocked */
  }
}

/**
 * Validates whether the local token exists, has valid 3-part JWT structure, and has not expired.
 */
export function isTokenValid(token = getStoredAuthToken()) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.trim().split('.');
  if (parts.length !== 3) return false;
  // Reject any legacy mock tokens that didn't come from the backend JWT signer
  if (parts[0].startsWith('snapsec-')) return false;

  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const jsonStr = decodeURIComponent(
      atob(base64)
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join(''),
    );
    const payload = JSON.parse(jsonStr);
    if (!payload || !payload.email) return false;
    const nowSec = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp <= nowSec) {
      return false; // Expired
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks if current user is logged in with a valid, non-expired session token.
 */
export function isAuthenticated() {
  const token = getStoredAuthToken();
  if (!token) return false;
  const valid = isTokenValid(token);
  if (!valid) {
    clearAuthSession();
    return false;
  }
  return true;
}
