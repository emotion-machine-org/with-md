'use client';

import type { ShareEventName, ShareEventProperties } from '@/lib/with-md/share-events';

function posthogEnabled(): boolean {
  const value = process.env.NEXT_PUBLIC_POSTHOG_ENABLED;
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export async function captureShareEvent(
  eventName: ShareEventName,
  properties: ShareEventProperties = {},
): Promise<void> {
  if (!posthogEnabled()) return;

  try {
    const { default: posthog } = await import('posthog-js');
    posthog.capture(eventName, properties);
  } catch {
    // Analytics must never block sharing.
  }
}
