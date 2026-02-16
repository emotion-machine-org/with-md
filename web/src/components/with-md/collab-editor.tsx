'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { EditorContent, useEditor } from '@tiptap/react';

import FormatToolbar from '@/components/with-md/format-toolbar';
import { usePeerCount } from '@/components/with-md/presence-strip';
import { buildEditorExtensions } from '@/components/with-md/tiptap/editor-extensions';
import { useCollabDoc } from '@/hooks/with-md/use-collab-doc';
import { extractHeadingPathAtIndex, findAllIndices, lineNumberAtIndex, pickBestQuoteIndex } from '@/lib/with-md/anchor';
import { normalizeAsciiDiagramBlocks } from '@/lib/with-md/ascii-diagram';
import type { AnchorMatch, CommentRecord, CommentSelectionDraft, CursorHint } from '@/lib/with-md/types';

interface Props {
  mdFileId: string;
  contentHash: string;
  realtimeEnabled: boolean;
  content: string;
  authToken: string;
  comments: CommentRecord[];
  anchorByCommentId: Map<string, AnchorMatch | null>;
  activeCommentId: string | null;
  focusedComment: CommentRecord | null;
  focusRequestId: number;
  pendingSelection: CommentSelectionDraft | null;
  onContentChange(next: string): void;
  onSelectionDraftChange(next: CommentSelectionDraft | null): void;
  onSelectComment(comment: CommentRecord): void;
  onReplyComment(parentComment: CommentRecord, body: string): Promise<void>;
  onCreateDraftComment(body: string, selection: CommentSelectionDraft): Promise<void>;
  onResolveThread(commentIds: string[]): Promise<void>;
  markRequest: { requestId: number; commentMarkId: string; from: number; to: number } | null;
  onMarkRequestApplied(requestId: number): void;
  collabUser?: { name: string; color: string };
  onPeerCountChange?(count: number): void;
  cursorHint?: CursorHint;
  cursorHintKey?: number;
  formatBarOpen?: boolean;
  commentsOpen?: boolean;
  onHydratedChange?(ready: boolean): void;
}

function getEditorMarkdown(editor: unknown): string | null {
  try {
    const fromMethod = (editor as { getMarkdown?: () => string }).getMarkdown?.();
    if (typeof fromMethod === 'string') return fromMethod;
  } catch {
    // fall through to manager-backed serializer
  }

  try {
    const fromEditorManager = (
      editor as { markdown?: { serialize?: (doc: unknown) => string }; getJSON?: () => unknown }
    ).markdown;
    const fromEditorManagerSerialized = fromEditorManager?.serialize?.(
      (editor as { getJSON?: () => unknown }).getJSON?.(),
    );
    if (typeof fromEditorManagerSerialized === 'string') return fromEditorManagerSerialized;
  } catch {
    // fall through to storage-backed serializer
  }

  try {
    const fromStorageManager = (
      editor as { storage?: { markdown?: { manager?: { serialize?: (doc: unknown) => string } } }; getJSON?: () => unknown }
    ).storage?.markdown?.manager;
    const fromStorageSerialized = fromStorageManager?.serialize?.(
      (editor as { getJSON?: () => unknown }).getJSON?.(),
    );
    if (typeof fromStorageSerialized === 'string') return fromStorageSerialized;
  } catch {
    // no markdown serializer available
  }

  return null;
}

function looksLikeStructuredMarkdown(text: string): boolean {
  return (
    /(^#{1,6}\s)|(^\s*[-*+]\s)|(^\s*\d+\.\s)|(^>\s)|(^\|.*\|$)|(^\|?\s*:?-{3,})/m.test(text) ||
    text.includes('\n\n')
  );
}

function unwrapTopLevelFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```[^\n]*\n([\s\S]*?)\n```$/);
  if (!match) return text;
  const inner = match[1] ?? '';
  return looksLikeStructuredMarkdown(inner) ? inner : text;
}

function stripAccidentalGlobalIndent(text: string): string {
  const lines = text.split('\n');
  const nonEmpty = lines.filter((line) => line.trim().length > 0);
  if (nonEmpty.length < 3) return text;

  const tabIndented = nonEmpty.filter((line) => line.startsWith('\t')).length;
  if (tabIndented >= Math.ceil(nonEmpty.length * 0.8) && looksLikeStructuredMarkdown(text.replace(/^\t/gm, ''))) {
    return lines.map((line) => (line.startsWith('\t') ? line.slice(1) : line)).join('\n');
  }

  const spaceIndents = nonEmpty
    .map((line) => {
      const match = line.match(/^ +/);
      return match ? match[0].length : 0;
    })
    .filter((count) => count > 0);

  if (spaceIndents.length < Math.ceil(nonEmpty.length * 0.8)) return text;
  const minIndent = Math.min(...spaceIndents);
  if (minIndent < 4) return text;

  const dedented = lines.map((line) => {
    if (!line.trim()) return line;
    return line.startsWith(' '.repeat(minIndent)) ? line.slice(minIndent) : line;
  }).join('\n');

  return looksLikeStructuredMarkdown(dedented) ? dedented : text;
}

function normalizePastedMarkdown(text: string): string {
  const unwrapped = unwrapTopLevelFence(text);
  return stripAccidentalGlobalIndent(unwrapped);
}

function findMarkedRangeInDoc(doc: ProseMirrorNode, commentMarkId: string): { from: number; to: number } | null {
  let firstFrom: number | null = null;
  let lastTo: number | null = null;

  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const hasCommentMark = node.marks.some(
      (mark) => mark.type.name === 'comment' && mark.attrs?.commentMarkId === commentMarkId,
    );
    if (!hasCommentMark) return;

    const textLength = node.text?.length ?? 0;
    if (textLength <= 0) return;

    if (firstFrom == null) {
      firstFrom = pos;
    }
    lastTo = pos + textLength;
  });

  if (firstFrom == null || lastTo == null || firstFrom >= lastTo) {
    return null;
  }
  return { from: firstFrom, to: lastTo };
}

function domPointAtOffset(range: Range, charOffset: number): { node: Node; offset: number } | null {
  const walker = document.createTreeWalker(
    range.commonAncestorContainer,
    NodeFilter.SHOW_TEXT,
  );
  let remaining = charOffset;
  let node = walker.currentNode.nodeType === Node.TEXT_NODE ? walker.currentNode : walker.nextNode();
  // Advance to the range start
  while (node && !range.intersectsNode(node)) {
    node = walker.nextNode();
  }
  while (node && range.intersectsNode(node)) {
    const text = node as Text;
    // How many chars of this node are inside the range?
    const nodeStart = node === range.startContainer ? range.startOffset : 0;
    const nodeEnd = node === range.endContainer ? range.endOffset : (text.nodeValue?.length ?? 0);
    const available = nodeEnd - nodeStart;
    if (remaining <= available) {
      return { node, offset: nodeStart + remaining };
    }
    remaining -= available;
    node = walker.nextNode();
  }
  return null;
}

function findDomRangeByQuote(root: HTMLElement, quote: string, occurrence = 0): Range | null {
  if (!quote.trim()) return null;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  const starts: number[] = [];
  let combined = '';

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const value = node.nodeValue ?? '';
    if (!value) continue;
    nodes.push(node);
    starts.push(combined.length);
    combined += value;
  }

  let hit = -1;
  let cursor = 0;
  for (let i = 0; i <= occurrence; i += 1) {
    const index = combined.indexOf(quote, cursor);
    if (index < 0) break;
    hit = index;
    cursor = index + Math.max(1, quote.length);
  }
  if (hit < 0) return null;
  const end = hit + quote.length;

  let startNodeIndex = -1;
  let endNodeIndex = -1;
  let startOffset = 0;
  let endOffset = 0;

  for (let i = 0; i < nodes.length; i += 1) {
    const nodeStart = starts[i];
    const nodeEnd = nodeStart + (nodes[i].nodeValue?.length ?? 0);
    if (startNodeIndex < 0 && hit >= nodeStart && hit <= nodeEnd) {
      startNodeIndex = i;
      startOffset = hit - nodeStart;
    }
    if (endNodeIndex < 0 && end >= nodeStart && end <= nodeEnd) {
      endNodeIndex = i;
      endOffset = end - nodeStart;
      break;
    }
  }

  if (startNodeIndex < 0 || endNodeIndex < 0) return null;

  const range = document.createRange();
  range.setStart(nodes[startNodeIndex], startOffset);
  range.setEnd(nodes[endNodeIndex], endOffset);
  return range;
}

function findQuoteRangeInEditorDom(
  editor: Editor,
  quote: string,
  preferredStart: number | undefined,
  markdownHint?: string,
): { from: number; to: number } | null {
  const markdown = getEditorMarkdown(editor) ?? markdownHint ?? '';
  const matches = findAllIndices(markdown, quote);

  let occurrence = 0;
  if (typeof preferredStart === 'number' && matches.length > 1) {
    const nearest = matches
      .map((value, idx) => ({ idx, delta: Math.abs(value - preferredStart) }))
      .sort((a, b) => a.delta - b.delta)[0];
    occurrence = nearest?.idx ?? 0;
  }

  const domRange = findDomRangeByQuote(editor.view.dom, quote, occurrence);
  if (!domRange) return null;

  try {
    const from = editor.view.posAtDOM(domRange.startContainer, domRange.startOffset);
    const to = editor.view.posAtDOM(domRange.endContainer, domRange.endOffset);
    if (from === to) return null;
    return from < to ? { from, to } : { from: to, to: from };
  } catch {
    return null;
  }
}

function focusEditorRange(editor: Editor, from: number, to: number) {
  const state = (editor as { state?: { tr?: unknown } }).state;
  if (!state?.tr) return;
  const commands = editor.commands as unknown as {
    focus: () => boolean;
    setTextSelection: (value: { from: number; to: number }) => boolean;
  };
  commands.focus();
  commands.setTextSelection({ from, to });
  editor.view.dispatch((state.tr as { scrollIntoView: () => unknown }).scrollIntoView() as never);
}

function clearOrphanCommentMarks(editor: Editor, activeCommentMarkIds: Set<string>) {
  const state = editor.state;
  let tr = state.tr;
  let changed = false;

  state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    const textLength = node.text?.length ?? 0;
    if (textLength <= 0) return;

    const orphanCommentMark = node.marks.find((mark) => {
      if (mark.type.name !== 'comment') return false;
      const markId = typeof mark.attrs?.commentMarkId === 'string' ? mark.attrs.commentMarkId : '';
      return !markId || !activeCommentMarkIds.has(markId);
    });
    if (!orphanCommentMark) return;

    tr = tr.removeMark(pos, pos + textLength, orphanCommentMark);
    changed = true;
  });

  if (changed && tr.docChanged) {
    editor.view.dispatch(tr);
  }
}

function ensureCommentMarksFromAnchors(
  editor: Editor,
  comments: CommentRecord[],
  anchorByCommentId: Map<string, AnchorMatch | null>,
  markdown: string,
) {
  const markType = editor.state.schema.marks.comment;
  if (!markType) return;

  const state = editor.state;
  let tr = state.tr;
  let changed = false;
  const handledMarkIds = new Set<string>();

  for (const comment of comments) {
    const markId = comment.anchor.commentMarkId?.trim();
    if (!markId || handledMarkIds.has(markId)) continue;
    handledMarkIds.add(markId);

    if (findMarkedRangeInDoc(state.doc, markId)) {
      continue;
    }

    let targetRange: { from: number; to: number } | null = null;
    if (comment.anchor.textQuote.trim()) {
      targetRange = findQuoteRangeInEditorDom(editor, comment.anchor.textQuote, comment.anchor.rangeStart, markdown);
    }

    if (!targetRange) {
      const recovered = anchorByCommentId.get(comment.id) ?? null;
      if (recovered && recovered.end > recovered.start) {
        const recoveredQuote = markdown.slice(recovered.start, recovered.end);
        if (recoveredQuote.trim()) {
          targetRange = findQuoteRangeInEditorDom(editor, recoveredQuote, recovered.start, markdown);
        }
      }
    }

    if (!targetRange) continue;

    const from = Math.max(1, Math.min(targetRange.from, targetRange.to));
    const to = Math.max(from + 1, Math.max(targetRange.from, targetRange.to));
    tr = tr.addMark(from, to, markType.create({ commentMarkId: markId }));
    changed = true;
  }

  if (changed && tr.docChanged) {
    editor.view.dispatch(tr);
  }
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

function findDocPosByApproxLine(doc: ProseMirrorNode, sourceLine: number): number {
  if (!Number.isFinite(sourceLine) || sourceLine <= 1) return 1;

  let blockCount = 0;
  let targetPos = 1;
  let found = false;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.isBlock) {
      blockCount += 1;
      if (blockCount >= sourceLine) {
        targetPos = pos + 1;
        found = true;
        return false;
      }
    }
    return true;
  });

  return Math.max(1, Math.min(targetPos, Math.max(1, doc.content.size)));
}

export default function CollabEditor({
  mdFileId,
  contentHash,
  realtimeEnabled,
  content,
  authToken,
  collabUser,
  onPeerCountChange,
  comments,
  anchorByCommentId,
  activeCommentId,
  focusedComment,
  focusRequestId,
  pendingSelection,
  onContentChange,
  onSelectionDraftChange,
  onSelectComment,
  onReplyComment,
  onCreateDraftComment,
  onResolveThread,
  markRequest,
  onMarkRequestApplied,
  cursorHint,
  cursorHintKey,
  formatBarOpen,
  commentsOpen,
  onHydratedChange,
}: Props) {
  const enableRealtime = realtimeEnabled;

  const { ydoc, provider, connected, reason } = useCollabDoc({
    mdFileId,
    contentHash,
    token: authToken,
    enabled: enableRealtime,
  });
  const lastLocalMarkdownRef = useRef<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [railTick, setRailTick] = useState(0);
  const [replyDraftByThread, setReplyDraftByThread] = useState<Record<string, string>>({});
  const [replyingThreadId, setReplyingThreadId] = useState<string | null>(null);
  const realtimeActive = enableRealtime && Boolean(provider);

  const peerCount = usePeerCount(provider, connected, collabUser?.name ?? 'withmd-user');
  useEffect(() => {
    onPeerCountChange?.(peerCount);
  }, [peerCount, onPeerCountChange]);

  const editor = useEditor({
    immediatelyRender: false,
    editorProps: {
      attributes: { class: 'withmd-prose' },
    },
    extensions: buildEditorExtensions({
      ydoc,
      provider,
      user: collabUser ?? { name: 'withmd-user', color: '#c7d2fe' },
      enableRealtime,
    }),
    ...(realtimeActive
      ? {}
      : {
        contentType: 'markdown' as const,
        content,
      }),
    onUpdate({ editor: nextEditor }) {
      const markdown = getEditorMarkdown(nextEditor);
      if (markdown == null) return;
      lastLocalMarkdownRef.current = markdown;
      onContentChange(markdown);
    },
    onSelectionUpdate({ editor: nextEditor }) {
      const state = (nextEditor as { state?: { selection?: { from: number; to: number; empty: boolean }; doc?: ProseMirrorNode } }).state;
      if (!state?.selection || !state.doc) {
        onSelectionDraftChange(null);
        return;
      }

      const { from, to, empty } = state.selection;
      if (empty) {
        onSelectionDraftChange(null);
        return;
      }

      const textQuote = state.doc.textBetween(from, to, '\n', '\n').trim();
      if (!textQuote) {
        onSelectionDraftChange(null);
        return;
      }

      const markdown = getEditorMarkdown(nextEditor) ?? content;
      // Use the selection's current doc line as the disambiguation hint for repeated quotes.
      const textBeforeSelection = state.doc.textBetween(1, from, '\n', '\n');
      const fallbackLineHint = Math.max(1, textBeforeSelection.split('\n').length);
      const rangeStart = pickBestQuoteIndex(markdown, textQuote, {
        fallbackLine: fallbackLineHint,
      }) ?? findAllIndices(markdown, textQuote)[0];
      const rangeEnd = typeof rangeStart === 'number' ? rangeStart + textQuote.length : undefined;
      const fallbackLine = typeof rangeStart === 'number'
        ? lineNumberAtIndex(markdown, rangeStart)
        : fallbackLineHint;
      const anchorPrefix = typeof rangeStart === 'number'
        ? markdown.slice(Math.max(0, rangeStart - 32), rangeStart)
        : '';
      const anchorSuffix = typeof rangeEnd === 'number'
        ? markdown.slice(rangeEnd, Math.min(markdown.length, rangeEnd + 32))
        : '';
      const anchorHeadingPath = typeof rangeStart === 'number'
        ? extractHeadingPathAtIndex(markdown, rangeStart)
        : [];

      const start = nextEditor.view.coordsAtPos(from);
      const end = nextEditor.view.coordsAtPos(to);
      const left = Math.min(start.left, end.left);
      const right = Math.max(start.right, end.right);
      const top = Math.min(start.top, end.top);
      const bottom = Math.max(start.bottom, end.bottom);

      onSelectionDraftChange({
        source: 'edit',
        textQuote,
        anchorPrefix,
        anchorSuffix,
        anchorHeadingPath,
        fallbackLine,
        rangeStart,
        rangeEnd,
        selectionFrom: from,
        selectionTo: to,
        rect: {
          left,
          top,
          width: Math.max(right - left, 12),
          height: Math.max(bottom - top, 12),
        },
      });
    },
  });

  useEffect(() => {
    if (!editor || !onHydratedChange) return;

    const isReadyNow = () => {
      if (!realtimeActive) return true;
      if ((content ?? '').trim().length === 0) return true;
      const doc = editor.state?.doc;
      if (!doc) return false;
      return doc.content.size > 2 || doc.textContent.trim().length > 0;
    };

    if (isReadyNow()) {
      onHydratedChange(true);
      return;
    }

    onHydratedChange(false);
    let attempts = 0;
    const maxAttempts = 80; // ~4s at 50ms
    const timer = window.setInterval(() => {
      attempts += 1;
      if (isReadyNow() || attempts >= maxAttempts) {
        onHydratedChange(isReadyNow());
        window.clearInterval(timer);
      }
    }, 50);

    return () => {
      window.clearInterval(timer);
    };
  }, [content, editor, onHydratedChange, realtimeActive]);

  useEffect(() => {
    if (!editor) return;
    if (realtimeActive) return;
    const current = getEditorMarkdown(editor);
    if (current == null) return;
    if (current === content) return;

    // Avoid resetting history when the update originated from this editor instance.
    if (lastLocalMarkdownRef.current === content) {
      return;
    }

    // Keep local editor in sync when switching modes or files.
    (editor.commands as unknown as { setContent: (value: string, options?: { contentType?: string }) => boolean })
      .setContent(content, { contentType: 'markdown' });
  }, [content, editor, realtimeActive]);

  useEffect(() => {
    if (!editor) return;

    const onPaste = (event: ClipboardEvent) => {
      const clipboard = event.clipboardData;
      if (!clipboard) return;

      const markdownText = clipboard.getData('text/markdown');
      const plainText = clipboard.getData('text/plain');
      const text = (markdownText || plainText).replace(/\r\n/g, '\n');
      if (!text) return;

      const looksLikeMarkdown = looksLikeStructuredMarkdown(text) || text.includes('```');
      const shouldTreatAsMarkdown = Boolean(markdownText) || looksLikeMarkdown;
      const normalized = shouldTreatAsMarkdown
        ? normalizePastedMarkdown(text)
        : normalizeAsciiDiagramBlocks(text);

      if (!shouldTreatAsMarkdown && normalized === text) return;

      event.preventDefault();
      (
        editor.chain() as unknown as {
          focus: () => {
            insertContent: (value: string, options?: { contentType?: string }) => { run: () => boolean };
          };
        }
      )
        .focus()
        .insertContent(normalized, { contentType: 'markdown' })
        .run();
    };

    let editorDom: HTMLElement | null = null;
    try {
      editorDom = editor.view.dom as HTMLElement;
    } catch {
      return;
    }

    editorDom.addEventListener('paste', onPaste);
    return () => {
      editorDom?.removeEventListener('paste', onPaste);
    };
  }, [editor]);

  useEffect(() => {
    if (!editor || !markRequest) return;
    const { commentMarkId, from, to, requestId } = markRequest;
    if (from >= to) {
      onMarkRequestApplied(requestId);
      return;
    }

    (
      editor.chain() as unknown as {
        focus: () => {
          setTextSelection: (value: { from: number; to: number }) => {
            setMark: (name: string, attrs: Record<string, string>) => { run: () => boolean };
          };
        };
      }
    )
      .focus()
      .setTextSelection({ from, to })
      .setMark('comment', { commentMarkId })
      .run();

    onMarkRequestApplied(requestId);
  }, [editor, markRequest, onMarkRequestApplied]);

  useEffect(() => {
    if (!editor || !focusedComment) return;
    if (!editor.state?.doc) return;

    const { commentMarkId, textQuote, rangeStart } = focusedComment.anchor;
    const markedRange = commentMarkId ? findMarkedRangeInDoc(editor.state.doc, commentMarkId) : null;
    const fallbackRange = !markedRange && textQuote.trim()
      ? findQuoteRangeInEditorDom(editor, textQuote, rangeStart, getEditorMarkdown(editor) ?? content)
      : null;
    const target = markedRange ?? fallbackRange;
    if (!target) return;

    focusEditorRange(editor, target.from, target.to);
  }, [editor, focusRequestId, focusedComment]);

  useEffect(() => {
    if (!editor) return;

    const activeMarkIds = new Set<string>();
    for (const comment of comments) {
      const markId = comment.anchor.commentMarkId?.trim();
      if (markId) {
        activeMarkIds.add(markId);
      }
    }
    clearOrphanCommentMarks(editor, activeMarkIds);
  }, [comments, editor]);

  useEffect(() => {
    if (!editor) return;

    // Rehydrate missing inline highlights from persisted anchors.
    const markdown = getEditorMarkdown(editor) ?? content;
    ensureCommentMarksFromAnchors(editor, comments, anchorByCommentId, markdown);
  }, [anchorByCommentId, comments, content, editor]);

  const lastAppliedKeyRef = useRef<number>(-1);
  useEffect(() => {
    if (!editor || !cursorHint || typeof cursorHintKey !== 'number') return;
    if (!editor.state?.doc) return;
    if (cursorHintKey === lastAppliedKeyRef.current) return;

    const { textFragment, sourceLine, offsetInFragment } = cursorHint;
    const commands = editor.commands as unknown as {
      setTextSelection: (pos: number) => boolean;
    };

    const tryPlaceCursor = (): boolean => {
      // Wait for collaborative doc hydration before applying fallback-to-start behavior.
      if (editor.state.doc.content.size <= 2) {
        return false;
      }

      // Try to place cursor at the precise position within the matched text
      if (textFragment) {
        const range = findDomRangeByQuote(editor.view.dom, textFragment, 0);
        if (range) {
          try {
            let targetPos: number;
            if (typeof offsetInFragment === 'number' && offsetInFragment > 0) {
              const domPoint = domPointAtOffset(range, offsetInFragment);
              targetPos = domPoint
                ? editor.view.posAtDOM(domPoint.node, domPoint.offset)
                : editor.view.posAtDOM(range.startContainer, range.startOffset);
            } else {
              targetPos = editor.view.posAtDOM(range.startContainer, range.startOffset);
            }
            commands.setTextSelection(targetPos);
            editor.view.focus();
            return true;
          } catch {
            // fall through to sourceLine
          }
        }
      }

      // Fallback: place cursor at the start of the approximate source line
      if (typeof sourceLine === 'number') {
        let blockCount = 0;
        let targetPos = 1;
        let found = false;
        editor.state.doc.descendants((node, pos) => {
          if (found) return false;
          if (node.isBlock) {
            blockCount += 1;
            if (blockCount >= sourceLine) {
              targetPos = pos + 1;
              found = true;
              return false;
            }
          }
          return true;
        });
        try {
          commands.setTextSelection(Math.min(targetPos, editor.state.doc.content.size));
          editor.view.focus();
        } catch {
          return false;
        }
        return true;
      }

      // No hint: just focus the editor
      try {
        editor.view.focus();
      } catch {
        return false;
      }
      return true;
    };

    if (tryPlaceCursor()) {
      lastAppliedKeyRef.current = cursorHintKey;
      return;
    }

    // Retry while collaborative hydration finishes so one click can enter and place cursor.
    let attempts = 0;
    const maxAttempts = 24; // ~2s at 85ms
    const retryTimer = window.setInterval(() => {
      attempts += 1;
      if (tryPlaceCursor()) {
        lastAppliedKeyRef.current = cursorHintKey;
        window.clearInterval(retryTimer);
        return;
      }
      if (attempts >= maxAttempts) {
        window.clearInterval(retryTimer);
      }
    }, 85);

    return () => {
      window.clearInterval(retryTimer);
    };
  }, [editor, cursorHint, cursorHintKey]);

  useEffect(() => {
    if (!editor) return;

    let raf = 0;
    const scheduleRailReflow = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        setRailTick((value) => value + 1);
      });
    };

    const scrollEl = scrollContainerRef.current;
    scrollEl?.addEventListener('scroll', scheduleRailReflow, { passive: true });
    window.addEventListener('resize', scheduleRailReflow);
    editor.on('update', scheduleRailReflow);
    editor.on('selectionUpdate', scheduleRailReflow);
    scheduleRailReflow();

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      scrollEl?.removeEventListener('scroll', scheduleRailReflow);
      window.removeEventListener('resize', scheduleRailReflow);
      editor.off('update', scheduleRailReflow);
      editor.off('selectionUpdate', scheduleRailReflow);
    };
  }, [editor]);

  const getTopForDocPos = useCallback((docPos: number): number => {
    if (!editor) return 0;
    const scrollEl = scrollContainerRef.current;
    if (!scrollEl) return 0;

    const cappedPos = Math.max(1, Math.min(docPos, Math.max(1, editor.state.doc.content.size)));
    try {
      const coords = editor.view.coordsAtPos(cappedPos);
      const rect = scrollEl.getBoundingClientRect();
      // Rail is outside the scroll container, so use viewport-relative offset only.
      return coords.top - rect.top;
    } catch {
      return 0;
    }
  }, [editor, railTick]);

  const threadGroups = useMemo(() => {
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

    return {
      byId,
      grouped,
      orderedThreadIds: Array.from(grouped.keys()),
    };
  }, [comments]);

  const positionedThreads = useMemo(() => {
    if (!editor) return [];
    const viewportHeight = scrollContainerRef.current?.clientHeight ?? Number.POSITIVE_INFINITY;

    const markdown = getEditorMarkdown(editor) ?? content;
    const threads = threadGroups.orderedThreadIds
      .map((threadId) => {
        const messages = threadGroups.grouped.get(threadId);
        if (!messages || messages.length === 0) return null;

        const root = threadGroups.byId.get(threadId) ?? messages[0];
        const sortedMessages = [...messages].sort((a, b) => a.createdAt - b.createdAt);

        let docPos: number | null = null;
        if (root.anchor.commentMarkId) {
          const markRange = findMarkedRangeInDoc(editor.state.doc, root.anchor.commentMarkId);
          if (markRange) docPos = markRange.from;
        }

        if (docPos == null && root.anchor.textQuote.trim()) {
          const quoteRange = findQuoteRangeInEditorDom(editor, root.anchor.textQuote, root.anchor.rangeStart, markdown);
          if (quoteRange) docPos = quoteRange.from;
        }

        if (docPos == null) {
          const recovered = anchorByCommentId.get(root.id) ?? null;
          const fallbackLine = recovered
            ? lineNumberAtIndex(markdown, recovered.start)
            : root.anchor.fallbackLine;
          docPos = findDocPosByApproxLine(editor.state.doc, fallbackLine);
        }

        return {
          threadId,
          root,
          messages: sortedMessages,
          top: getTopForDocPos(docPos),
          estimatedHeight: estimatedThreadHeight(sortedMessages.length),
          hasActive: sortedMessages.some((message) => message.id === activeCommentId),
        };
      })
      .filter((thread): thread is NonNullable<typeof thread> => Boolean(thread))
      .filter((thread) => {
        // Exclude fully off-screen threads so they don't affect stacking layout.
        return thread.top + thread.estimatedHeight > 0 && thread.top < viewportHeight;
      })
      .sort((a, b) => a.top - b.top);

    let cursor = -Infinity;
    return threads.map((thread) => {
      const adjustedTop = Math.max(thread.top, cursor + 12);
      cursor = adjustedTop + thread.estimatedHeight;
      return { ...thread, top: adjustedTop };
    });
  }, [activeCommentId, anchorByCommentId, content, editor, getTopForDocPos, threadGroups, railTick]);

  const draftTop = useMemo(() => {
    if (!pendingSelection) return null;
    const scrollEl = scrollContainerRef.current;
    if (!scrollEl) return 0;
    const rect = scrollEl.getBoundingClientRect();

    if (pendingSelection.source === 'edit') {
      return pendingSelection.rect.top - rect.top;
    }

    const docPos = editor ? findDocPosByApproxLine(editor.state.doc, pendingSelection.fallbackLine) : 1;
    return getTopForDocPos(docPos);
  }, [editor, getTopForDocPos, pendingSelection, railTick]);

  const hasPositionedThreads = !commentsOpen && (positionedThreads.length > 0 || Boolean(pendingSelection));

  if (!editor) {
    return <p className="withmd-muted-sm">Loading editor...</p>;
  }

  const showStatus = enableRealtime && !connected && reason;

  return (
    <div className="withmd-column withmd-fill withmd-gap-2">
      {showStatus && <div className="withmd-muted-xs">{reason}</div>}
      <div className="withmd-editor-shell withmd-column withmd-fill">
        {formatBarOpen && <FormatToolbar editor={editor} />}
        <div ref={scrollContainerRef} className="withmd-prosemirror-wrap withmd-editor-scroll withmd-fill">
          <EditorContent editor={editor} />
        </div>
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
                      event.target.style.height = `${event.target.scrollHeight}px`;
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
            {positionedThreads.map((thread) => (
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
                    void onResolveThread(thread.messages.map((message) => message.id));
                  }}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z" />
                  </svg>
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
                      event.target.style.height = `${event.target.scrollHeight}px`;
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' || event.shiftKey) return;
                      event.preventDefault();
                      const body = (replyDraftByThread[thread.threadId] ?? '').trim();
                      if (!body || replyingThreadId === thread.threadId) return;
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
    </div>
  );
}
