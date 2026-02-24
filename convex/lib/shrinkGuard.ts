const SHRINK_GUARD_MIN_BYTES = 1024;
const SHRINK_GUARD_RATIO = 0.85;
const SHRINK_GUARD_MIN_DELTA_BYTES = 256;

export function shouldRejectSuspiciousShrink(existingBytes: number, incomingBytes: number): boolean {
  if (existingBytes < SHRINK_GUARD_MIN_BYTES) return false;
  if (incomingBytes >= existingBytes) return false;

  const delta = existingBytes - incomingBytes;
  if (delta < SHRINK_GUARD_MIN_DELTA_BYTES) return false;
  return incomingBytes < existingBytes * SHRINK_GUARD_RATIO;
}
