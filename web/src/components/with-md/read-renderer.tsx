'use client';

import { useEffect, useMemo, useRef } from 'react';

import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import {
  extractHeadingPathAtIndex,
  findAllIndices,
  findApproximateQuoteInMarkdown,
  findSectionByHeadingPath,
  lineNumberAtIndex,
} from '@/lib/with-md/anchor';
import type { AnchorMatch, CommentRecord, CommentSelectionDraft } from '@/lib/with-md/types';

interface Props {
  content: string;
  comments: CommentRecord[];
  focusedCommentId: string | null;
  focusedAnchorMatch: AnchorMatch | null;
  focusRequestId: number;
  onSelectionDraftChange(next: CommentSelectionDraft | null): void;
}

function findDomRangeByQuote(root: HTMLElement, quote: string, occurrence = 0): Range | null {
  if (!quote.trim()) return null;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  const lengths: number[] = [];
  let combined = '';

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    nodes.push(node);
    lengths.push(combined.length);
    combined += node.nodeValue ?? '';
  }

  let hit = -1;
  let searchFrom = 0;
  for (let i = 0; i <= occurrence; i += 1) {
    const next = combined.indexOf(quote, searchFrom);
    if (next < 0) break;
    hit = next;
    searchFrom = next + Math.max(1, quote.length);
  }
  if (hit < 0) return null;
  const end = hit + quote.length;

  let startNodeIndex = -1;
  let endNodeIndex = -1;
  let startOffset = 0;
  let endOffset = 0;

  for (let i = 0; i < nodes.length; i += 1) {
    const startBase = lengths[i];
    const value = nodes[i].nodeValue ?? '';
    const stop = startBase + value.length;
    if (startNodeIndex < 0 && hit >= startBase && hit <= stop) {
      startNodeIndex = i;
      startOffset = hit - startBase;
    }
    if (endNodeIndex < 0 && end >= startBase && end <= stop) {
      endNodeIndex = i;
      endOffset = end - startBase;
      break;
    }
  }

  if (startNodeIndex < 0 || endNodeIndex < 0) return null;

  const range = document.createRange();
  range.setStart(nodes[startNodeIndex], startOffset);
  range.setEnd(nodes[endNodeIndex], endOffset);
  return range;
}

function setCssHighlight(range: Range | null) {
  const cssAny = (window as unknown as { CSS?: { highlights?: Map<string, unknown> } }).CSS;
  const highlightCtor = (window as unknown as { Highlight?: new (...args: Range[]) => unknown }).Highlight;
  if (!cssAny?.highlights) return;

  cssAny.highlights.delete('withmd-active-comment');
  if (!range || !highlightCtor) return;

  cssAny.highlights.set('withmd-active-comment', new highlightCtor(range));
}

function findClosestSourceLineElement(root: HTMLElement, targetLine: number): HTMLElement | null {
  const elements = Array.from(root.querySelectorAll<HTMLElement>('[data-source-line]'));
  if (elements.length === 0) return null;

  let best: { element: HTMLElement; delta: number } | null = null;
  for (const element of elements) {
    const raw = element.dataset.sourceLine;
    if (!raw) continue;
    const line = Number(raw);
    if (!Number.isFinite(line)) continue;
    const delta = Math.abs(line - targetLine);
    if (!best || delta < best.delta) {
      best = { element, delta };
    }
  }
  return best?.element ?? null;
}

function flashAnchorElement(root: HTMLElement, target: HTMLElement) {
  const prev = root.querySelector<HTMLElement>('.withmd-anchor-focus');
  if (prev && prev !== target) prev.classList.remove('withmd-anchor-focus');
  target.classList.add('withmd-anchor-focus');
  window.setTimeout(() => {
    target.classList.remove('withmd-anchor-focus');
  }, 1200);
}

function extractHeadingPathFromDom(root: HTMLElement, startNode: Node): string[] {
  const headings = Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6'));
  if (headings.length === 0) return [];

  const startEl = startNode.nodeType === Node.ELEMENT_NODE
    ? (startNode as Element)
    : startNode.parentElement;
  if (!startEl) return [];

  let targetHeading: Element | null = startEl.closest('h1, h2, h3, h4, h5, h6');
  if (!targetHeading) {
    for (const heading of headings) {
      const relation = heading.compareDocumentPosition(startEl);
      if (relation & Node.DOCUMENT_POSITION_FOLLOWING || heading.contains(startEl)) {
        targetHeading = heading;
      }
      if (relation & Node.DOCUMENT_POSITION_PRECEDING) {
        break;
      }
    }
  }
  if (!targetHeading) return [];

  const path: Array<{ level: number; text: string }> = [];
  for (const heading of headings) {
    const level = Number(heading.tagName.slice(1));
    const text = heading.textContent?.trim();
    if (!text) continue;

    while (path.length >= level) path.pop();
    path.push({ level, text });

    if (heading === targetHeading) {
      return path.map((entry) => entry.text);
    }
  }

  return [];
}

export default function ReadRenderer({
  content,
  comments,
  focusedCommentId,
  focusedAnchorMatch,
  focusRequestId,
  onSelectionDraftChange,
}: Props) {
  const rootRef = useRef<HTMLElement | null>(null);
  const markdownComponents = useMemo(() => {
    type SourceTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'p' | 'li' | 'pre' | 'blockquote' | 'table' | 'tr' | 'hr';
    const withSourceLine = (tag: SourceTag) =>
      function SourceLineTag(props: Record<string, unknown>) {
        const Tag = tag;
        const node = props.node as { position?: { start?: { line?: number } } } | undefined;
        const line = node?.position?.start?.line;
        const nextProps = { ...props } as Record<string, unknown>;
        delete nextProps.node;
        return (
          // eslint-disable-next-line react/jsx-props-no-spreading
          <Tag {...nextProps} data-source-line={typeof line === 'number' ? String(line) : undefined} />
        );
      };

    return {
      h1: withSourceLine('h1'),
      h2: withSourceLine('h2'),
      h3: withSourceLine('h3'),
      h4: withSourceLine('h4'),
      h5: withSourceLine('h5'),
      h6: withSourceLine('h6'),
      p: withSourceLine('p'),
      li: withSourceLine('li'),
      pre: withSourceLine('pre'),
      blockquote: withSourceLine('blockquote'),
      table: withSourceLine('table'),
      tr: withSourceLine('tr'),
      hr: withSourceLine('hr'),
    };
  }, []) as Components;
  const focusedComment = useMemo(
    () => comments.find((comment) => comment.id === focusedCommentId) ?? null,
    [comments, focusedCommentId],
  );

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const updateSelectionDraft = () => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        return;
      }

      const range = selection.getRangeAt(0);
      const container = range.commonAncestorContainer;
      if (!root.contains(container)) {
        return;
      }

      const textQuote = selection.toString().trim();
      if (!textQuote) {
        return;
      }

      const domHeadingPath = extractHeadingPathFromDom(root, range.startContainer);
      const exactMatches = findAllIndices(content, textQuote);
      let approximate = null as ReturnType<typeof findApproximateQuoteInMarkdown>;
      if (exactMatches.length === 0 && domHeadingPath.length > 0) {
        const section = findSectionByHeadingPath(content, domHeadingPath);
        if (section) {
          const inSection = findApproximateQuoteInMarkdown(section.content, textQuote);
          if (inSection) {
            approximate = {
              start: section.start + inSection.start,
              end: section.start + inSection.end,
            };
          }
        }
      }
      if (exactMatches.length === 0 && !approximate) {
        approximate = findApproximateQuoteInMarkdown(content, textQuote);
      }
      const rangeStart = exactMatches[0] ?? approximate?.start;
      const rangeEnd = typeof exactMatches[0] === 'number'
        ? exactMatches[0] + textQuote.length
        : approximate?.end;
      const fallbackSection = domHeadingPath.length > 0 ? findSectionByHeadingPath(content, domHeadingPath) : null;
      const fallbackLine = typeof rangeStart === 'number'
        ? lineNumberAtIndex(content, rangeStart)
        : fallbackSection
          ? lineNumberAtIndex(content, fallbackSection.start)
          : 1;

      const anchorPrefix = typeof rangeStart === 'number'
        ? content.slice(Math.max(0, rangeStart - 32), rangeStart)
        : '';
      const anchorSuffix = typeof rangeEnd === 'number'
        ? content.slice(rangeEnd, Math.min(content.length, rangeEnd + 32))
        : '';
      const anchorHeadingPath = domHeadingPath.length > 0
        ? domHeadingPath
        : typeof rangeStart === 'number'
          ? extractHeadingPathAtIndex(content, rangeStart)
          : [];

      const rect = range.getBoundingClientRect();
      onSelectionDraftChange({
        source: 'read',
        textQuote,
        anchorPrefix,
        anchorSuffix,
        anchorHeadingPath,
        fallbackLine,
        rangeStart,
        rangeEnd,
        rect: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        },
      });
    };

    root.addEventListener('mouseup', updateSelectionDraft);
    root.addEventListener('keyup', updateSelectionDraft);

    return () => {
      root.removeEventListener('mouseup', updateSelectionDraft);
      root.removeEventListener('keyup', updateSelectionDraft);
      setCssHighlight(null);
    };
  }, [content, onSelectionDraftChange]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !focusedComment) {
      setCssHighlight(null);
      return;
    }

    let didScroll = false;
    const preferredLine = focusedAnchorMatch
      ? lineNumberAtIndex(content, focusedAnchorMatch.start)
      : focusedComment.anchor.fallbackLine;
    const anchorElement = Number.isFinite(preferredLine)
      ? findClosestSourceLineElement(root, preferredLine)
      : null;
    if (anchorElement) {
      flashAnchorElement(root, anchorElement);
      anchorElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      didScroll = true;
    }

    const quote = focusedComment.anchor.textQuote;
    const matches = findAllIndices(content, quote);
    const preferredStart = focusedAnchorMatch?.start ?? focusedComment.anchor.rangeStart;
    let occurrence = 0;
    if (typeof preferredStart === 'number' && matches.length > 1) {
      const nearest = matches
        .map((value, idx) => ({ idx, delta: Math.abs(value - preferredStart) }))
        .sort((a, b) => a.delta - b.delta)[0];
      occurrence = nearest?.idx ?? 0;
    }

    const range = findDomRangeByQuote(root, quote, occurrence);
    if (range) {
      setCssHighlight(range);
      if (!didScroll) {
        const marker = range.startContainer.parentElement ?? root;
        marker.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else {
      setCssHighlight(null);
    }
  }, [content, focusRequestId, focusedAnchorMatch, focusedComment]);

  return (
    <article ref={rootRef} className="withmd-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{content}</ReactMarkdown>
    </article>
  );
}
