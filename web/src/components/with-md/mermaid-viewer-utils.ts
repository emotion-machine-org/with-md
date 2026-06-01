export const MIN_MERMAID_SCALE = 0.15;
export const MAX_MERMAID_SCALE = 3;

export type DiagramSize = {
  width: number;
  height: number;
};

type WheelLike = {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  deltaY: number;
  deltaX: number;
};

export function clampMermaidScale(scale: number) {
  return Math.min(MAX_MERMAID_SCALE, Math.max(MIN_MERMAID_SCALE, scale));
}

export function scrollNearestPageContainer(start: HTMLElement, deltaY: number) {
  let current: HTMLElement | null = start.parentElement;

  while (current) {
    const style = window.getComputedStyle(current);
    const canScrollVertically =
      current.scrollHeight > current.clientHeight &&
      /auto|scroll|overlay/.test(style.overflowY);

    if (canScrollVertically) {
      current.scrollBy({ top: deltaY, behavior: 'auto' });
      return;
    }

    current = current.parentElement;
  }

  window.scrollBy({ top: deltaY, behavior: 'auto' });
}

export function shouldPassVerticalWheel(e: WheelLike) {
  return (
    !e.ctrlKey &&
    !e.metaKey &&
    !e.shiftKey &&
    Math.abs(e.deltaY) > 0 &&
    Math.abs(e.deltaY) >= Math.abs(e.deltaX)
  );
}

function parseSvgLength(value: string | null) {
  if (!value || value.endsWith('%')) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function getSvgNaturalSize(svg: SVGSVGElement): DiagramSize | null {
  const viewBox = svg.viewBox.baseVal;
  if (viewBox.width > 0 && viewBox.height > 0) {
    return { width: viewBox.width, height: viewBox.height };
  }

  const width = parseSvgLength(svg.getAttribute('width'));
  const height = parseSvgLength(svg.getAttribute('height'));
  if (width && height) return { width, height };

  try {
    const box = svg.getBBox();
    if (box.width > 0 && box.height > 0) {
      return { width: box.width, height: box.height };
    }
  } catch {
    // Some browsers can throw if the SVG has not been laid out yet.
  }

  const rect = svg.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    return { width: rect.width, height: rect.height };
  }

  return null;
}

function getViewportInnerSize(viewport: HTMLElement) {
  const style = window.getComputedStyle(viewport);
  const paddingX = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
  const paddingY = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
  const maxHeight = parseSvgLength(style.maxHeight);
  const heightLimit = maxHeight ?? viewport.clientHeight;

  return {
    width: Math.max(0, viewport.clientWidth - paddingX),
    height: Math.max(0, heightLimit - paddingY),
  };
}

export function getFitScale(viewport: HTMLElement, size: DiagramSize) {
  const available = getViewportInnerSize(viewport);
  if (!available.width || !available.height) return 1;

  return Math.min(
    1,
    clampMermaidScale(Math.min(available.width / size.width, available.height / size.height)),
  );
}

export function applySvgScale(svgHost: HTMLElement | null, size: DiagramSize | null, scale: number) {
  const svg = svgHost?.querySelector('svg') as SVGSVGElement | null;
  if (!svg || !size) return;

  svg.style.width = `${Math.ceil(size.width * scale)}px`;
  svg.style.height = `${Math.ceil(size.height * scale)}px`;
  svg.style.maxWidth = 'none';
}
