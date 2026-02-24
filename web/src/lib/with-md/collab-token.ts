/**
 * HMAC-SHA256 signed collab tokens for authenticated users.
 *
 * Token format: usr1:<userId>:<timestampMs>:<base64url-hmac>
 *
 * Shared signing logic used by the /api/auth/collab-token route.
 * Verification happens in convex/collab.ts using the same secret.
 */

const TOKEN_PREFIX = 'usr1';
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getSecret(): string {
  const secret = process.env.WITHMD_COLLAB_TOKEN_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('WITHMD_COLLAB_TOKEN_SECRET is required in production');
    }
    // In development, use a deterministic fallback so local dev works out of the box.
    return 'dev-collab-token-secret-min-32-chars!';
  }
  return secret;
}

async function hmacSign(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  // base64url encode (no padding)
  const bytes = new Uint8Array(sig);
  let b64 = '';
  for (const byte of bytes) {
    b64 += String.fromCharCode(byte);
  }
  return btoa(b64).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function signCollabToken(userId: string): Promise<string> {
  const secret = getSecret();
  const now = Date.now();
  const payload = `${TOKEN_PREFIX}:${userId}:${now}`;
  const hmac = await hmacSign(secret, payload);
  return `${payload}:${hmac}`;
}

export { TOKEN_PREFIX, TOKEN_TTL_MS };
