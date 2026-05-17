'use client';

import posthog from 'posthog-js';

type PostHogValue = string | number | boolean | null | undefined;
type PostHogProperties = Record<string, PostHogValue>;

function sanitizeProperties(properties: PostHogProperties): Record<string, string | number | boolean | null> {
  return Object.fromEntries(
    Object.entries(properties).filter(([, value]) => value !== undefined),
  ) as Record<string, string | number | boolean | null>;
}

export function captureWithMdEvent(eventName: string, properties: PostHogProperties = {}): void {
  if (typeof window === 'undefined') return;
  try {
    posthog.capture(eventName, sanitizeProperties(properties));
  } catch {
    // Analytics should never break product actions.
  }
}

export function captureWithMdCoreAction(eventName: string, properties: PostHogProperties = {}): void {
  const cleanProperties = sanitizeProperties(properties);
  captureWithMdEvent(eventName, cleanProperties);
  captureWithMdEvent('withmd_active_use', {
    ...cleanProperties,
    source_event: eventName,
  });
}

export function captureWithMdCoreActionOnce(sessionKey: string, eventName: string, properties: PostHogProperties = {}): void {
  if (typeof window === 'undefined') return;
  const storageKey = `withmd-posthog:${sessionKey}`;
  try {
    if (window.sessionStorage.getItem(storageKey) === '1') return;
    window.sessionStorage.setItem(storageKey, '1');
  } catch {
    // Fall through and capture even if sessionStorage is unavailable.
  }
  captureWithMdCoreAction(eventName, properties);
}

export function fileExtensionFromName(name: string): string {
  const trimmed = name.trim().toLowerCase();
  const lastDot = trimmed.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === trimmed.length - 1) return 'none';
  return trimmed.slice(lastDot + 1);
}

export function bucketFileSize(bytes: number): string {
  if (bytes < 1_000) return 'lt_1kb';
  if (bytes < 10_000) return '1kb_to_10kb';
  if (bytes < 100_000) return '10kb_to_100kb';
  if (bytes < 1_000_000) return '100kb_to_1mb';
  return 'gte_1mb';
}
