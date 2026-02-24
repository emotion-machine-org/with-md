'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export function useScrollbarWidth<T extends HTMLElement>() {
  const elementRef = useRef<T | null>(null);
  const [element, setElement] = useState<T | null>(null);
  const [scrollbarWidth, setScrollbarWidth] = useState(0);
  const ref = useCallback((node: T | null) => {
    if (elementRef.current === node) return;
    elementRef.current = node;
    setElement(node);
  }, []);

  useEffect(() => {
    if (!element) {
      setScrollbarWidth(0);
      return;
    }

    const updateScrollbarWidth = () => {
      const nextWidth = Math.max(0, element.offsetWidth - element.clientWidth);
      setScrollbarWidth(nextWidth);
    };

    updateScrollbarWidth();

    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      updateScrollbarWidth();
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [element]);

  return { ref, element, scrollbarWidth } as const;
}
