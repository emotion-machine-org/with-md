import {
  sanitizeFirstUseProperties,
  type FirstUseEventName,
  type FirstUseFlow,
  type FirstUseProperties,
} from './first-use-events';

const CAPTURE_TIMEOUT_MS = 1500;

function envFlagEnabled(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function posthogConfig() {
  const enabled = envFlagEnabled(process.env.POSTHOG_ENABLED)
    || envFlagEnabled(process.env.NEXT_PUBLIC_POSTHOG_ENABLED);
  const token = (process.env.POSTHOG_TOKEN ?? process.env.NEXT_PUBLIC_POSTHOG_TOKEN ?? '').trim();
  const host = (process.env.POSTHOG_HOST ?? process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com').trim();

  if (!enabled || !token) return null;
  return {
    token,
    host: host.replace(/\/+$/, ''),
  };
}

export async function captureFirstUseServerEvent(input: {
  event: FirstUseEventName;
  flow: FirstUseFlow;
  distinctId: string;
  properties?: FirstUseProperties;
}) {
  const config = posthogConfig();
  if (!config || !input.distinctId) return;

  const properties = sanitizeFirstUseProperties({
    ...input.properties,
    flow: input.flow,
    product: 'with.md',
    measurement_area: 'first_use',
  });

  try {
    await fetch(`${config.host}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: config.token,
        event: input.event,
        distinct_id: input.distinctId,
        properties,
      }),
      signal: AbortSignal.timeout(CAPTURE_TIMEOUT_MS),
    });
  } catch (error) {
    console.warn(
      '[with-md:first-use-analytics] capture failed',
      input.event,
      error instanceof Error ? error.message : 'unknown error',
    );
  }
}
