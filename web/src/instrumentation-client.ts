function envFlagEnabled(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

const posthogEnabled = envFlagEnabled(process.env.NEXT_PUBLIC_POSTHOG_ENABLED);
const posthogToken = process.env.NEXT_PUBLIC_POSTHOG_TOKEN?.trim() ?? '';
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim() || 'https://us.i.posthog.com';

if (posthogEnabled && posthogToken) {
  const autocaptureEnabled = envFlagEnabled(process.env.NEXT_PUBLIC_POSTHOG_AUTOCAPTURE);
  const recordingEnabled = envFlagEnabled(process.env.NEXT_PUBLIC_POSTHOG_RECORDING);

  void import('posthog-js').then(({ default: posthog }) => {
    posthog.init(posthogToken, {
      api_host: posthogHost,
      defaults: '2026-01-30',
      capture_pageview: true,
      capture_pageleave: true,
      autocapture: autocaptureEnabled,
      disable_session_recording: !recordingEnabled,
      person_profiles: 'identified_only',
    });
  });
}
