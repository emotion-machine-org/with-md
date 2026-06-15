export const FIRST_USE_EVENTS = {
  shareCreated: 'withmd_first_use_share_created',
  editLinkOpened: 'withmd_first_use_edit_link_opened',
  saveCompleted: 'withmd_first_use_save_completed',
  githubConnected: 'withmd_first_use_github_connected',
  repoSynced: 'withmd_first_use_repo_synced',
  pushBackCompleted: 'withmd_first_use_push_back_completed',
} as const;

export type FirstUseEventName = (typeof FIRST_USE_EVENTS)[keyof typeof FIRST_USE_EVENTS];
export type FirstUseFlow = 'anonymous_share' | 'github_workspace';

export type FirstUsePropertyValue = string | number | boolean | null | undefined;
export type FirstUseProperties = Record<string, FirstUsePropertyValue>;

const PRIVATE_KEY_PATTERN = /(content|markdown|source|secret|token|body)/i;

export function sanitizeFirstUseProperties(properties: FirstUseProperties = {}): Record<string, string | number | boolean | null> {
  const sanitized: Record<string, string | number | boolean | null> = {};

  for (const [key, value] of Object.entries(properties)) {
    if (!key || PRIVATE_KEY_PATTERN.test(key)) continue;
    if (value === undefined) continue;
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      sanitized[key] = value;
    }
  }

  return sanitized;
}
