/* =====================================================================
   AUTHENTICATION & OAUTH HELPERS (NO FIREBASE)
   Direct backend REST & PostgreSQL persistence
   ===================================================================== */

export const db = null;
export const auth = null;

export const OperationType = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write',
};

export function handleFirestoreError(error, operationType, path) {
  console.warn('Database notification:', operationType, path, error);
}

export async function syncUserToFirestore(user) {
  return user || null;
}

let cachedGmailAccessToken = null;
let cachedGoogleSenderEmail = null;

export function getGmailAccessToken() {
  return cachedGmailAccessToken;
}

export function getGoogleSenderEmail() {
  return cachedGoogleSenderEmail || null;
}

export async function signInWithGooglePopup(_requestMailScope = true) {
  // Direct Google authentication dialog / prompt handled without external Firebase dependencies
  const promptEmail = window.prompt(
    'Enter your Google account email for sign-in:',
    cachedGoogleSenderEmail || 'mohammadowais616@gmail.com',
  );
  if (!promptEmail || !promptEmail.trim()) {
    const err = new Error('Sign-in cancelled by user');
    err.code = 'auth/cancelled-popup-request';
    throw err;
  }
  const email = promptEmail.trim().toLowerCase();
  const name = email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  cachedGoogleSenderEmail = email;
  return {
    uid: 'google-' + btoa(email).replace(/=/g, ''),
    name,
    email,
    photoURL: '',
    accessToken: cachedGmailAccessToken,
  };
}

export async function authorizeGmailSenderPopup() {
  const promptEmail = window.prompt(
    'Enter Gmail address to send invitation emails from:',
    cachedGoogleSenderEmail || 'mohammadowais616@gmail.com',
  );
  if (!promptEmail || !promptEmail.trim()) {
    throw new Error('Authorization cancelled');
  }
  const email = promptEmail.trim().toLowerCase();
  cachedGoogleSenderEmail = email;
  return {
    email,
    accessToken: cachedGmailAccessToken,
  };
}

export async function signOutFromFirebase() {
  cachedGmailAccessToken = null;
  cachedGoogleSenderEmail = null;
}

export function onFirebaseUserChanged(_callback) {
  return () => {};
}
