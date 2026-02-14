'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import {
  extractHeadingPathAtIndex,
  findApproximateQuoteInMarkdown,
  findSectionByHeadingPath,
  lineNumberAtIndex,
  pickBestQuoteIndex,
} from '@/lib/with-md/anchor';
import type { AnchorMatch, CommentRecord, CommentSelectionDraft } from '@/lib/with-md/types';

/* ------------------------------------------------------------------ */
/*  Rehype plugin: inject <mark> elements for comment highlights      */
/* ------------------------------------------------------------------ */

interface HighlightRange {
  start: number;
  end: number;
  commentId: string;
}

interface HastText {
  type: 'text';
  value: string;
  position?: { start?: { offset?: number }; end?: { offset?: number } };
}

interface HastElement {
  type: 'element';
  tagName: string;
  properties?: Record<string, unknown>;
  children: HastNode[];
}

type HastNode = HastText | HastElement | { type: string; children?: HastNode[] };

function collectTextNodes(
  node: HastNode,
  out: Array<{ node: HastText; index: number; parent: HastElement }>,
  insideCode = false,
) {
  if (!('children' in node) || !node.children) return;
  const el = node as HastElement;
  const isCode = el.tagName === 'code' || el.tagName === 'pre';

  for (let i = 0; i < el.children.length; i++) {
    const child = el.children[i];
    if (child.type === 'text' && !insideCode) {
      out.push({ node: child as HastText, index: i, parent: el });
    } else {
      collectTextNodes(child, out, insideCode || isCode);
    }
  }
}

function rehypeCommentHighlights(ranges: HighlightRange[]) {
  return (tree: HastNode) => {
    if (ranges.length === 0) return;

    const sorted = [...ranges].sort((a, b) => a.start - b.start);
    const textNodes: Array<{ node: HastText; index: number; parent: HastElement }> = [];
    collectTextNodes(tree, textNodes);

    // Process in reverse so splicing doesn't shift indices
    for (let t = textNodes.length - 1; t >= 0; t--) {
      const { node, index, parent } = textNodes[t];
      const pos = node.position;
      const nodeStart = pos?.start?.offset;
      const nodeEnd = pos?.end?.offset;
      if (nodeStart === undefined || nodeEnd === undefined) continue;

      const text = node.value;

      // Find highlight ranges that overlap this text node
      const overlapping = sorted.filter((r) => r.start < nodeEnd && r.end > nodeStart);
      if (overlapping.length === 0) continue;

      const replacements: HastNode[] = [];
      let cursor = 0;

      for (const range of overlapping) {
        const hlStart = Math.max(0, range.start - nodeStart);
        const hlEnd = Math.min(text.length, range.end - nodeStart);
        if (hlEnd <= hlStart) continue;

        if (hlStart > cursor) {
          replacements.push({ type: 'text', value: text.slice(cursor, hlStart) } as HastText);
        }

        replacements.push({
          type: 'element',
          tagName: 'mark',
          properties: { className: ['withmd-comment-highlight'], dataCommentId: range.commentId },
          children: [{ type: 'text', value: text.slice(hlStart, hlEnd) } as HastText],
        } as HastElement);

        cursor = hlEnd;
      }

      if (cursor < text.length) {
        replacements.push({ type: 'text', value: text.slice(cursor) } as HastText);
      }

      if (replacements.length > 0) {
        parent.children.splice(index, 1, ...replacements);
      }
    }
  };
}

/* ------------------------------------------------------------------ */
/*  Props & helpers                                                    */
/* ------------------------------------------------------------------ */

interface Props {
  content: string;
  comments: CommentRecord[];
  anchorByCommentId: Map<string, AnchorMatch | null>;
  activeCommentId: string | null;
  focusedCommentId: string | null;
  focusedAnchorMatch: AnchorMatch | null;
  focusRequestId: number;
  onSelectionDraftChange(next: CommentSelectionDraft | null): void;
  pendingSelection: CommentSelectionDraft | null;
  onSelectComment(comment: CommentRecord): void;
  onReplyComment(parentComment: CommentRecord, body: string): Promise<void>;
  onCreateDraftComment(body: string, selection: CommentSelectionDraft): Promise<void>;
  onResolveThread(commentIds: string[]): Promise<void>;
}

function setCssHighlightByName(name: string, range: Range | null) {
  const cssAny = (window as unknown as { CSS?: { highlights?: Map<string, unknown> } }).CSS;
  const highlightCtor = (window as unknown as { Highlight?: new (...args: Range[]) => unknown }).Highlight;
  if (!cssAny?.highlights) return;

  cssAny.highlights.delete(name);
  if (!range || !highlightCtor) return;

  cssAny.highlights.set(name, new highlightCtor(range));
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

function rootCommentId(byId: Map<string, CommentRecord>, comment: CommentRecord): string {
  let current = comment;
  while (current.parentCommentId) {
    const parent = byId.get(current.parentCommentId);
    if (!parent) break;
    current = parent;
  }
  return current.id;
}

function estimatedThreadHeight(messageCount: number): number {
  return 90 + Math.min(6, messageCount) * 34 + 56;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function ReadRenderer({
  content,
  comments,
  anchorByCommentId,
  activeCommentId,
  focusedCommentId,
  focusedAnchorMatch,
  focusRequestId,
  onSelectionDraftChange,
  pendingSelection,
  onSelectComment,
  onReplyComment,
  onCreateDraftComment,
  onResolveThread,
}: Props) {
  const markdownRef = useRef<HTMLElement | null>(null);
  const pendingRangeRef = useRef<Range | null>(null);
  const [replyDraftByThread, setReplyDraftByThread] = useState<Record<string, string>>({});
  const [replyingThreadId, setReplyingThreadId] = useState<string | null>(null);
  const [lineAnchors, setLineAnchors] = useState<Array<{ line: number; top: number }>>([]);

  // ---- Compute highlight ranges for the rehype plugin ----
  const commentHighlightRanges = useMemo(() => {
    const ranges: HighlightRange[] = [];
    const byId = new Map(comments.map((c) => [c.id, c]));
    const seen = new Set<string>();

    for (const comment of comments) {
      const threadId = rootCommentId(byId, comment);
      if (seen.has(threadId)) continue;
      seen.add(threadId);

      const root = byId.get(threadId) ?? comment;
      const anchor = anchorByCommentId.get(root.id);
      if (!anchor || anchor.end <= anchor.start) continue;

      ranges.push({ start: anchor.start, end: anchor.end, commentId: root.id });
    }

    return ranges;
  }, [comments, anchorByCommentId]);

  // ---- Rehype plugin (new ref each time ranges change → ReactMarkdown re-processes) ----
  const rehypePlugins = useMemo(() => {
    if (commentHighlightRanges.length === 0) return [];
    return [() => rehypeCommentHighlights(commentHighlightRanges)];
  }, [commentHighlightRanges]);

  // ---- Markdown components with data-source-line ----
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

  // ---- Measure line positions for comment rail ----
  useEffect(() => {
    const root = markdownRef.current;
    if (!root) return;

    const measure = () => {
      const elements = Array.from(root.querySelectorAll<HTMLElement>('[data-source-line]'));
      const lineToTop = new Map<number, number>();
      for (const element of elements) {
        const raw = element.dataset.sourceLine;
        if (!raw) continue;
        const line = Number(raw);
        if (!Number.isFinite(line)) continue;
        const top = element.offsetTop;
        const prev = lineToTop.get(line);
        if (prev == null || top < prev) {
          lineToTop.set(line, top);
        }
      }
      const sorted = Array.from(lineToTop.entries())
        .map(([line, top]) => ({ line, top }))
        .sort((a, b) => a.line - b.line);
      setLineAnchors(sorted);
    };

    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(root);
    window.addEventListener('resize', measure);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [content, comments.length]);

  const findTopByLine = useMemo(() => {
    return (targetLine: number): number => {
      if (!lineAnchors.length) return 0;
      let nearest = lineAnchors[0];
      for (const anchor of lineAnchors) {
        if (Math.abs(anchor.line - targetLine) < Math.abs(nearest.line - targetLine)) {
          nearest = anchor;
        }
      }
      return nearest.top;
    };
  }, [lineAnchors]);

  // ---- Position comment threads in the rail ----
  const positionedThreads = useMemo(() => {
    const byId = new Map(comments.map((comment) => [comment.id, comment]));
    const grouped = new Map<string, CommentRecord[]>();

    for (const comment of comments) {
      const threadId = rootCommentId(byId, comment);
      const existing = grouped.get(threadId);
      if (existing) {
        existing.push(comment);
      } else {
        grouped.set(threadId, [comment]);
      }
    }

    const ordered = Array.from(grouped.entries())
      .map(([threadId, messages]) => {
        const root = byId.get(threadId) ?? messages[0];
        const anchor = anchorByCommentId.get(root.id) ?? anchorByCommentId.get(messages[0].id) ?? null;
        const line = anchor ? lineNumberAtIndex(content, anchor.start) : root.anchor.fallbackLine;
        const top = findTopByLine(line);
        const sortedMessages = [...messages].sort((a, b) => a.createdAt - b.createdAt);
        return {
          threadId,
          root,
          messages: sortedMessages,
          top,
          hasActive: sortedMessages.some((message) => message.id === activeCommentId),
        };
      })
      .sort((a, b) => a.top - b.top);

    let cursor = -Infinity;
    return ordered.map((thread) => {
      const adjustedTop = Math.max(thread.top, cursor + 12);
      cursor = adjustedTop + estimatedThreadHeight(thread.messages.length);
      return { ...thread, top: adjustedTop };
    });
  }, [activeCommentId, anchorByCommentId, comments, content, findTopByLine]);

  const draftTop = useMemo(() => {
    if (!pendingSelection) return null;
    const line = pendingSelection.fallbackLine;
    return findTopByLine(line);
  }, [findTopByLine, pendingSelection]);

  const hasPositionedThreads = positionedThreads.length > 0 || Boolean(pendingSelection);

  // ---- Focused comment: toggle .is-focused class + scroll ----
  useEffect(() => {
    const root = markdownRef.current;
    if (!root) return;

    // Clear previous focus
    root.querySelectorAll<HTMLElement>('.withmd-comment-highlight.is-focused')
      .forEach((el) => el.classList.remove('is-focused'));

    if (!focusedComment) return;

    // Find the root comment ID for this thread
    const byId = new Map(comments.map((c) => [c.id, c]));
    const threadRootId = rootCommentId(byId, focusedComment);

    // Add .is-focused to all marks for this thread
    const marks = root.querySelectorAll<HTMLElement>(
      `.withmd-comment-highlight[data-comment-id="${threadRootId}"]`,
    );
    marks.forEach((el) => el.classList.add('is-focused'));

    // Scroll to the anchor
    const preferredLine = focusedAnchorMatch
      ? lineNumberAtIndex(content, focusedAnchorMatch.start)
      : focusedComment.anchor.fallbackLine;
    const anchorElement = Number.isFinite(preferredLine)
      ? findClosestSourceLineElement(root, preferredLine)
      : null;

    if (anchorElement) {
      flashAnchorElement(root, anchorElement);
      anchorElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (marks.length > 0) {
      marks[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [comments, content, focusRequestId, focusedAnchorMatch, focusedComment]);

  // ---- Selection draft (for creating new comments) ----
  useEffect(() => {
    const root = markdownRef.current;
    if (!root) return;

    const updateSelectionDraft = () => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        onSelectionDraftChange(null);
        return;
      }

      const range = selection.getRangeAt(0);
      const container = range.commonAncestorContainer;
      if (!root.contains(container)) {
        onSelectionDraftChange(null);
        return;
      }

      const textQuote = selection.toString().trim();
      if (!textQuote) {
        onSelectionDraftChange(null);
        return;
      }

      const domHeadingPath = extractHeadingPathFromDom(root, range.startContainer);
      const startEl = range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as Element)
        : range.startContainer.parentElement;
      const sourceLineAttr = startEl?.closest('[data-source-line]')?.getAttribute('data-source-line');
      const domSourceLine = sourceLineAttr ? parseInt(sourceLineAttr, 10) : undefined;
      const bestExact = pickBestQuoteIndex(content, textQuote, {
        fallbackLine: domSourceLine,
        anchorHeadingPath: domHeadingPath,
      });
      let approximate = null as ReturnType<typeof findApproximateQuoteInMarkdown>;
      if (typeof bestExact !== 'number' && domHeadingPath.length > 0) {
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
      if (typeof bestExact !== 'number' && !approximate) {
        approximate = findApproximateQuoteInMarkdown(content, textQuote);
      }
      const rangeStart = bestExact ?? approximate?.start;
      const rangeEnd = typeof bestExact === 'number'
        ? bestExact + textQuote.length
        : approximate?.end;

      const fallbackSection = domHeadingPath.length > 0 ? findSectionByHeadingPath(content, domHeadingPath) : null;
      const fallbackLine = typeof rangeStart === 'number'
        ? lineNumberAtIndex(content, rangeStart)
        : typeof domSourceLine === 'number' && Number.isFinite(domSourceLine)
          ? domSourceLine
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

      const clonedRange = range.cloneRange();
      pendingRangeRef.current = clonedRange;
      setCssHighlightByName('withmd-pending-selection', clonedRange);

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
    };
  }, [content, onSelectionDraftChange]);

  useEffect(() => {
    if (!pendingSelection) {
      setCssHighlightByName('withmd-pending-selection', null);
      pendingRangeRef.current = null;
    }
  }, [pendingSelection]);

  return (
    <div className="withmd-read-layout">
      <article ref={markdownRef} className="withmd-prose withmd-markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins} components={markdownComponents}>{content}</ReactMarkdown>
      </article>
      {hasPositionedThreads && (
        <aside className="withmd-comment-rail withmd-comment-rail-floating" aria-label="Anchored comment threads">
          {pendingSelection && (
            <section className="withmd-rail-thread is-draft" style={{ top: draftTop ?? 0 }}>
              <div className="withmd-rail-reply">
                <textarea
                  className="withmd-rail-reply-input"
                  placeholder="Add a comment..."
                  rows={1}
                  onChange={(event) => {
                    event.target.style.height = 'auto';
                    event.target.style.height = event.target.scrollHeight + 'px';
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' || event.shiftKey) return;
                    event.preventDefault();
                    const body = (event.target as HTMLTextAreaElement).value.trim();
                    if (!body) return;
                    const textarea = event.target as HTMLTextAreaElement;
                    void onCreateDraftComment(body, pendingSelection).then(() => {
                      textarea.value = '';
                      textarea.style.height = 'auto';
                    });
                  }}
                />
              </div>
            </section>
          )}
          {!pendingSelection && positionedThreads.map((thread) => (
            <section
              key={thread.threadId}
              className={`withmd-rail-thread ${thread.hasActive ? 'is-active' : ''}`}
              style={{ top: thread.top }}
            >
              <button
                type="button"
                className="withmd-rail-resolve"
                aria-label="Resolve thread"
                onClick={(event) => {
                  event.stopPropagation();
                  void onResolveThread(thread.messages.map((m) => m.id));
                }}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z" /></svg>
              </button>
              <div className="withmd-rail-messages">
                {thread.messages.map((message) => (
                  <button
                    key={message.id}
                    type="button"
                    className={`withmd-rail-message ${message.id === activeCommentId ? 'is-active' : ''}`}
                    onClick={() => onSelectComment(message)}
                  >
                    <span className="withmd-rail-author">{message.authorId}</span>
                    <span className="withmd-rail-body">{message.body}</span>
                  </button>
                ))}
              </div>
              <div className="withmd-rail-reply">
                <textarea
                  className="withmd-rail-reply-input"
                  placeholder="Reply..."
                  rows={1}
                  value={replyDraftByThread[thread.threadId] ?? ''}
                  onChange={(event) => {
                    const next = event.target.value;
                    setReplyDraftByThread((prev) => ({ ...prev, [thread.threadId]: next }));
                    event.target.style.height = 'auto';
                    event.target.style.height = event.target.scrollHeight + 'px';
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' || event.shiftKey) return;
                    event.preventDefault();
                    const body = (replyDraftByThread[thread.threadId] ?? '').trim();
                    if (!body) return;
                    setReplyingThreadId(thread.threadId);
                    const target = event.target as HTMLTextAreaElement;
                    void onReplyComment(thread.root, body)
                      .then(() => {
                        setReplyDraftByThread((prev) => ({ ...prev, [thread.threadId]: '' }));
                        target.style.height = 'auto';
                      })
                      .finally(() => {
                        setReplyingThreadId((prev) => (prev === thread.threadId ? null : prev));
                      });
                  }}
                />
              </div>
            </section>
          ))}
        </aside>
      )}
    </div>
  );
}
