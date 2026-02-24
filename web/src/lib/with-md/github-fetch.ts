const REAUTH_KEY = 'withmd-reauth-attempted';

/**
 * Check a GitHub API response for 401 (stale token) and trigger a silent
 * re-auth via the OAuth flow. Includes loop prevention via sessionStorage.
 */
export function handleGitHubResponse(res: Response): void {
  if (res.status === 401) {
    if (!sessionStorage.getItem(REAUTH_KEY)) {
      sessionStorage.setItem(REAUTH_KEY, '1');
      window.location.href = '/api/auth/github';
      return;
    }
    // Already tried re-auth this session — clear flag and let error surface
    sessionStorage.removeItem(REAUTH_KEY);
  }
}

/**
 * Clear the re-auth loop prevention flag. Call on successful page load
 * so the next stale-token scenario can attempt re-auth again.
 */
export function clearReauthFlag(): void {
  sessionStorage.removeItem(REAUTH_KEY);
}
