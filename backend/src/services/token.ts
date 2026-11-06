import crypto from 'node:crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'snapsec_super_secret_jwt_key_2026_production';
const DEFAULT_TOKEN_TTL_SEC = 7 * 24 * 3600; // 7 days default, 30 days when rememberMe is enabled

export interface TokenPayload {
  email: string;
  name?: string;
  sub?: string;
  sid?: string;
  exp: number;
  iat: number;
}

/**
 * Hashes a plaintext password using Node's built-in cryptographic scrypt KDF
 * with a unique 16-byte random salt per password.
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${derivedKey}`;
}

/**
 * Verifies a plaintext password against a stored scrypt hash using constant-time comparison.
 */
export function verifyPassword(password: string, storedHash: string | null | undefined): boolean {
  if (!password || !storedHash || typeof storedHash !== 'string') {
    return false;
  }
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }
  const [, salt, originalHashHex] = parts;
  if (!salt || !originalHashHex) {
    return false;
  }
  try {
    const derivedBuf = crypto.scryptSync(String(password), salt, 64);
    const originalBuf = Buffer.from(originalHashHex, 'hex');
    if (derivedBuf.length !== originalBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(derivedBuf, originalBuf);
  } catch {
    return false;
  }
}

/**
 * Generates a cryptographically strong random token for invitations, password resets, or email verification.
 */
export function generateSecureToken(prefix = 'tok'): string {
  return `${prefix}_${crypto.randomBytes(24).toString('hex')}`;
}

export function generateAuthToken(
  user: { email: string; name?: string; id?: string; sessionId?: string },
  rememberMe = true,
): {
  token: string;
  expiresAt: number;
} {
  const iat = Math.floor(Date.now() / 1000);
  const ttl = rememberMe ? 30 * 24 * 3600 : DEFAULT_TOKEN_TTL_SEC;
  const exp = iat + ttl;
  const payload: TokenPayload = {
    email: user.email.toLowerCase().trim(),
    name: user.name || '',
    sub: user.id || 'm1',
    ...(user.sessionId ? { sid: user.sessionId } : {}),
    iat,
    exp,
  };

  const headerB64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');

  return {
    token: `${headerB64}.${payloadB64}.${signature}`,
    expiresAt: exp * 1000,
  };
}

export function verifyAuthToken(token: string): { valid: boolean; payload?: TokenPayload; reason?: string } {
  if (!token || typeof token !== 'string') {
    return { valid: false, reason: 'No token provided' };
  }
  const parts = token.trim().split('.');
  if (parts.length !== 3) {
    return { valid: false, reason: 'Malformed token structure' };
  }
  const [headerB64, payloadB64, signature] = parts;
  const expectedSig = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');

  if (
    signature.length !== expectedSig.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))
  ) {
    return { valid: false, reason: 'Invalid signature' };
  }

  try {
    const payload: TokenPayload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp <= now) {
      return { valid: false, reason: 'Token has expired' };
    }
    return { valid: true, payload };
  } catch {
    return { valid: false, reason: 'Failed to parse token payload' };
  }
}
