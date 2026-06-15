import {
  sanitizeFirstUseProperties,
  type FirstUseEventName,
  type FirstUseFlow,
  type FirstUseProperties,
} from './first-use-events';

function envFlagEnabled(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function captureFirstUseClientEvent(input: {
  event: FirstUseEventName;
  flow: FirstUseFlow;
  distinctId?: string;
  properties?: FirstUseProperties;
}) {
  if (typeof window === 'undefined') return;
  if (!envFlagEnabled(process.env.NEXT_PUBLIC_POSTHOG_ENABLED)) return;

  const properties = sanitizeFirstUseProperties({
    ...input.properties,
    flow: input.flow,
    product: 'with.md',
    measurement_area: 'first_use',
  });

  void import('posthog-js').then(({ default: posthog }) => {
    posthog.capture(input.event, properties);
  }).catch(() => {
    /* Analytics must never block first use. */
  });
}
