import { createHash, randomBytes } from 'node:crypto';

const SHORT_ID_BYTES = 16;
const EDIT_SECRET_BYTES = 16;
const SHORT_ID_HASH_SCOPE = 'withmd:repo-share:short-id';
const EDIT_SECRET_HASH_SCOPE = 'withmd:repo-share:edit-secret';
const REALTIME_AUTH_PREFIX = 'rse1';

function hashScoped(scope: string, value: string): string {
  return createHash('sha256').update(`${scope}:${value}`).digest('hex');
}

export function generateRepoShareShortId(): string {
  return randomBytes(SHORT_ID_BYTES).toString('base64url');
}

export function generateRepoShareEditSecret(): string {
  return randomBytes(EDIT_SECRET_BYTES).toString('base64url');
}

export function hashRepoShareShortId(shortId: string): string {
  return hashScoped(SHORT_ID_HASH_SCOPE, shortId);
}

export function hashRepoShareEditSecret(editSecret: string): string {
  return hashScoped(EDIT_SECRET_HASH_SCOPE, editSecret);
}

export function buildRepoShareRealtimeAuthToken(shortId: string, editSecret: string): string {
  return `${REALTIME_AUTH_PREFIX}:${shortId}:${editSecret}`;
}

export function repoShareViewUrl(origin: string, shortId: string): string {
  return `${origin}/r/${encodeURIComponent(shortId)}`;
}

export function repoShareEditUrl(origin: string, shortId: string, editSecret: string): string {
  return `${repoShareViewUrl(origin, shortId)}?edit=${encodeURIComponent(editSecret)}`;
}
