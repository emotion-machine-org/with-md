'use client';

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Components } from 'react-markdown';
import { renderMermaidSVG } from 'beautiful-mermaid';
import {
  MAX_MERMAID_SCALE,
  MIN_MERMAID_SCALE,
  applySvgScale,
  clampMermaidScale,
  getFitScale,
  getSvgNaturalSize,
  scrollNearestPageContainer,
  shouldPassVerticalWheel,
  type DiagramSize,
} from './mermaid-viewer-utils';

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
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(null);
  const labelVisible = useRef(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const svgHostRef = useRef<HTMLDivElement>(null);
  const zoomLabelRef = useRef<HTMLSpanElement>(null);
  const diagramSize = useRef<DiagramSize | null>(null);
  const userZoomed = useRef(false);

  const showZoomLabel = useCallback(() => {
    labelVisible.current = true;
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      labelVisible.current = false;
      if (zoomLabelRef.current) {
        zoomLabelRef.current.style.display = 'none';
      }
    }, 1200);
  }, []);

  useLayoutEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  const updateScale = useCallback((nextScale: number | ((current: number) => number)) => {
    userZoomed.current = true;
    setScale((current) => {
      const next = typeof nextScale === 'function' ? nextScale(current) : nextScale;
      return clampMermaidScale(next);
    });
    showZoomLabel();
  }, [showZoomLabel]);

  const fitDiagram = useCallback(() => {
    if (!viewportRef.current || !diagramSize.current) return;
    const fitScale = getFitScale(viewportRef.current, diagramSize.current);
    applySvgScale(svgHostRef.current, diagramSize.current, fitScale);
    setScale(fitScale);
  }, []);

  useLayoutEffect(() => {
    const svgEl = svgHostRef.current?.querySelector('svg') as SVGSVGElement | null;
    if (!svgEl) return;

    userZoomed.current = false;
    diagramSize.current = getSvgNaturalSize(svgEl);
    fitDiagram();
    const fitFrame = requestAnimationFrame(() => {
      if (!userZoomed.current) fitDiagram();
    });

    return () => cancelAnimationFrame(fitFrame);
  }, [fitDiagram, svg]);

  useLayoutEffect(() => {
    applySvgScale(svgHostRef.current, diagramSize.current, scale);
    if (zoomLabelRef.current) {
      zoomLabelRef.current.textContent = `${Math.round(scale * 100)}%`;
      zoomLabelRef.current.style.display = labelVisible.current ? '' : 'none';
    }
  });

  const onWheel = useCallback((e: React.WheelEvent) => {
    if (shouldPassVerticalWheel(e)) {
      e.preventDefault();
      e.stopPropagation();
      scrollNearestPageContainer(e.currentTarget as HTMLElement, e.deltaY);
      return;
    }

    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    updateScale((current) => current * factor);
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
      <div ref={viewportRef} className="withmd-mermaid-viewport">
        <div className="withmd-mermaid-zoom">
          <div ref={svgHostRef} className="withmd-mermaid-svg" dangerouslySetInnerHTML={{ __html: svg ?? '' }} />
        </div>
      </div>
      <span ref={zoomLabelRef} className="withmd-mermaid-zoom-label" style={{ display: 'none' }} />
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
