const DEFAULT_INLINE_REALTIME_MAX_BYTES = 900 * 1024;

function parsePositiveInt(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export const INLINE_REALTIME_MAX_BYTES =
  parsePositiveInt(process.env.WITHMD_INLINE_REALTIME_MAX_BYTES) ?? DEFAULT_INLINE_REALTIME_MAX_BYTES;

const textEncoder = new TextEncoder();

export function markdownByteLength(markdown: string): number {
  return textEncoder.encode(markdown).byteLength;
}
