'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import type { Components } from 'react-markdown';
import { renderMermaidSVG } from 'beautiful-mermaid';

const MIN_MERMAID_SCALE = 0.15;
const MAX_MERMAID_SCALE = 3;

function scrollNearestPageContainer(start: HTMLElement, deltaY: number) {
  let el = start.parentElement;
  while (el && el !== document.body) {
    const style = window.getComputedStyle(el);
    const canScroll = /(auto|scroll|overlay)/.test(style.overflowY);
    if (canScroll && el.scrollHeight > el.clientHeight) {
      el.scrollTop += deltaY;
      return;
    }
    el = el.parentElement;
  }

  if (document.scrollingElement) {
    document.scrollingElement.scrollTop += deltaY;
    return;
  }

  window.scrollBy({ top: deltaY, left: 0 });
}

function shouldPassVerticalWheel(e: React.WheelEvent) {
  return !e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX);
}

function MermaidPreview({ code }: { code: string }) {
  const { svg, error } = useMemo(() => {
    try {
      return {
        svg: renderMermaidSVG(code, {
          bg: 'var(--background, #ffffff)',
          fg: 'var(--foreground, #27272a)',
          transparent: true,
          font: 'Geist, ui-sans-serif, system-ui, sans-serif',
        }),
        error: null as string | null,
      };
    } catch (err) {
      return { svg: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [code]);

  const [scale, setScale] = useState(1);
  const [showLabel, setShowLabel] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(null);

  const showZoomLabel = useCallback(() => {
    setShowLabel(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowLabel(false), 1200);
  }, []);

  const updateScale = useCallback((nextScale: number | ((current: number) => number)) => {
    setScale((current) => {
      const next = typeof nextScale === 'function' ? nextScale(current) : nextScale;
      return Math.min(MAX_MERMAID_SCALE, Math.max(MIN_MERMAID_SCALE, next));
    });
    showZoomLabel();
  }, [showZoomLabel]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      updateScale((current) => current * factor);
      return;
    }

    // Keep normal page scrolling from getting trapped inside tall diagrams.
    if (shouldPassVerticalWheel(e)) {
      e.preventDefault();
      e.stopPropagation();
      scrollNearestPageContainer(e.currentTarget as HTMLElement, e.deltaY);
    }
  }, [updateScale]);

  const zoomOut = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    updateScale((current) => current / 1.2);
  }, [updateScale]);

  const zoomIn = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    updateScale((current) => current * 1.2);
  }, [updateScale]);

  if (error) {
    return (
      <pre className="withmd-mermaid-error">{`Mermaid render error:\n${error}\n\n${code}`}</pre>
    );
  }
  return (
    <div className="withmd-mermaid-block" onWheel={onWheel}>
      <div className="withmd-mermaid-controls" aria-label="Mermaid diagram zoom controls">
        <button
          type="button"
          className="withmd-mermaid-zoom-btn"
          aria-label="Zoom out diagram"
          title="Zoom out"
          onClick={zoomOut}
          disabled={scale <= MIN_MERMAID_SCALE + 0.01}
        >
          -
        </button>
        <button
          type="button"
          className="withmd-mermaid-zoom-btn"
          aria-label="Zoom in diagram"
          title="Zoom in"
          onClick={zoomIn}
          disabled={scale >= MAX_MERMAID_SCALE - 0.01}
        >
          +
        </button>
      </div>
      <div className="withmd-mermaid-viewport">
        <div className="withmd-mermaid-zoom" style={{ transform: `scale(${scale})` }}>
          <div className="withmd-mermaid-svg" dangerouslySetInnerHTML={{ __html: svg ?? '' }} />
        </div>
      </div>
      {showLabel && <span className="withmd-mermaid-zoom-label">{Math.round(scale * 100)}%</span>}
    </div>
  );
}

function isMermaidFence(node: unknown): { mermaid: boolean; source: string } {
  // node is a hast Element from rehype; `pre > code` for fenced blocks.
  const root = node as {
    children?: Array<{
      type?: string;
      tagName?: string;
      properties?: { className?: string[] | string };
      children?: Array<{ type?: string; value?: string }>;
    }>;
  } | null;
  const code = root?.children?.find((child) => child?.tagName === 'code');
  if (!code) return { mermaid: false, source: '' };
  const rawClass = code.properties?.className;
  const classList = Array.isArray(rawClass) ? rawClass : typeof rawClass === 'string' ? [rawClass] : [];
  const hasMermaid = classList.some((c) => typeof c === 'string' && c.toLowerCase() === 'language-mermaid');
  if (!hasMermaid) return { mermaid: false, source: '' };
  const source = (code.children || [])
    .filter((c) => c?.type === 'text')
    .map((c) => c.value ?? '')
    .join('')
    .replace(/\n$/, '');
  return { mermaid: true, source };
}

export const proseMarkdownComponents: Components = {
  table: ({ node, ...props }) => (
    <div className="withmd-prose-table-scroll">
      <table {...props} />
    </div>
  ),
  pre: ({ node, children, ...props }) => {
    const detected = isMermaidFence(node);
    if (detected.mermaid) {
      return <MermaidPreview code={detected.source} />;
    }
    return <pre {...props}>{children}</pre>;
  },
};
