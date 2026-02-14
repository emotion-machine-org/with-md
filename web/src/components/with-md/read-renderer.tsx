'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

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

function setCssHighlightByName(name: string, range: Range | null) {
  const cssAny = (window as unknown as { CSS?: { highlights?: Map<string, unknown> } }).CSS;
  const highlightCtor = (window as unknown as { Highlight?: new (...args: Range[]) => unknown }).Highlight;
  if (!cssAny?.highlights) return;

  cssAny.highlights.delete(name);
  if (!range || !highlightCtor) return;

  cssAny.highlights.set(name, new highlightCtor(range));
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

function anchorLabel(comment: CommentRecord): string {
  const path = comment.anchor.anchorHeadingPath;
  if (path.length > 0) {
    const last = path[path.length - 1];
    return path.length > 1 ? `${path[0]} / ... / ${last}` : last;
  }
  return `Line ${comment.anchor.fallbackLine}`;
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
      setCssHighlight(null);
    };
  }, [content, onSelectionDraftChange]);

  useEffect(() => {
    const root = markdownRef.current;
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

  useEffect(() => {
    if (!pendingSelection) {
      setCssHighlightByName('withmd-pending-selection', null);
      pendingRangeRef.current = null;
    }
  }, [pendingSelection]);

  return (
    <div className="withmd-read-layout">
      <article ref={markdownRef} className="withmd-markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{content}</ReactMarkdown>
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
