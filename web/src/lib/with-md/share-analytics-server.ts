import type { ShareEventName, ShareEventProperties } from '@/lib/with-md/share-events';

function envFlagEnabled(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function posthogCaptureUrl(): string {
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim() || 'https://us.i.posthog.com';
  return `${host.replace(/\/$/, '')}/capture/`;
}

export async function captureShareEvent(
  eventName: ShareEventName,
  distinctId: string,
  properties: ShareEventProperties = {},
): Promise<void> {
  if (!envFlagEnabled(process.env.NEXT_PUBLIC_POSTHOG_ENABLED)) return;

  const token = process.env.POSTHOG_TOKEN?.trim() || process.env.NEXT_PUBLIC_POSTHOG_TOKEN?.trim();
  if (!token) return;

  try {
    await fetch(posthogCaptureUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(1500),
      body: JSON.stringify({
        api_key: token,
        event: eventName,
        distinct_id: distinctId,
        properties,
      }),
    });
  } catch {
    // Analytics must never block share creation.
  }
}
