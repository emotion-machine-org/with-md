export const SHARE_EVENTS = {
  anonymousShareStarted: 'anonymous_share_started',
  anonymousShareCreated: 'anonymous_share_created',
  shareLinkCopied: 'share_link_copied',
  sharedPageViewed: 'shared_page_viewed',
  recipientCreatedOwnShare: 'recipient_created_own_share',
} as const;

export type ShareEventName = typeof SHARE_EVENTS[keyof typeof SHARE_EVENTS];

export type ShareEntrySurface =
  | 'home_blank'
  | 'home_upload'
  | 'home_drop'
  | 'public_api'
  | 'shared_page'
  | 'unknown';

export interface ShareEventProperties {
  entry_surface?: ShareEntrySurface;
  source_path?: string;
  source_channel?: string;
  share_id?: string;
  source_share_id?: string;
  link_type?: 'view' | 'edit' | 'raw' | 'markdown_text';
  file_extension?: 'md' | 'markdown' | 'none' | 'other';
  size_bytes?: number;
  can_edit?: boolean;
  created_via?: 'browser' | 'public_api';
  status?: 'started' | 'succeeded' | 'failed';
  failure_reason?: string;
}

export function fileExtensionForShareEvent(fileName: string | null | undefined): ShareEventProperties['file_extension'] {
  const lower = (fileName ?? '').trim().toLowerCase();
  if (!lower) return 'none';
  if (lower.endsWith('.markdown')) return 'markdown';
  if (lower.endsWith('.md')) return 'md';
  return 'other';
}

export function sourceChannelFromPath(path: string | null | undefined): string {
  const normalized = (path ?? '').trim();
  if (!normalized || normalized === '/') return 'product_surface';
  if (normalized.startsWith('/s/')) return 'recipient_loop';
  if (normalized.startsWith('/skill')) return 'audience';
  if (normalized.startsWith('/r/')) return 'direct';
  return 'other';
}

export function sourceShareIdFromPath(path: string | null | undefined): string | null {
  const normalized = (path ?? '').trim();
  const match = normalized.match(/^\/s\/([^/?#]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function sourcePathFromRequestUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname || '/';
  } catch {
    return 'unknown';
  }
}

export function sourcePathFromReferer(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.pathname || '/';
  } catch {
    return null;
  }
}
