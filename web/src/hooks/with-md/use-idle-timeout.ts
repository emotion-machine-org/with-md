import { useEffect, useRef } from 'react';

import type { RefObject } from 'react';

const ACTIVITY_EVENTS = ['keydown', 'mousemove', 'mousedown', 'touchstart', 'input', 'scroll'] as const;

export function useIdleTimeout(opts: {
  containerRef: RefObject<HTMLElement | null>;
  timeout: number;
  enabled: boolean;
  onIdle: () => void;
}): void {
  const { containerRef, timeout, enabled, onIdle } = opts;
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    if (!enabled) return;
    const el = containerRef.current;
    if (!el) return;

    let timer = window.setTimeout(() => onIdleRef.current(), timeout);

    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => onIdleRef.current(), timeout);
    };

    for (const event of ACTIVITY_EVENTS) {
      el.addEventListener(event, reset, { passive: true });
    }

    return () => {
      window.clearTimeout(timer);
      for (const event of ACTIVITY_EVENTS) {
        el.removeEventListener(event, reset);
      }
    };
  }, [containerRef, timeout, enabled]);
}
