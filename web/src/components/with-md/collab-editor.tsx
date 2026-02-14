'use client';

import { useEffect, useRef } from 'react';

import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { EditorContent, useEditor } from '@tiptap/react';

import { buildEditorExtensions } from '@/components/with-md/tiptap/editor-extensions';
import { useCollabDoc } from '@/hooks/with-md/use-collab-doc';
import { extractHeadingPathAtIndex, findAllIndices, lineNumberAtIndex } from '@/lib/with-md/anchor';
import { normalizeAsciiDiagramBlocks } from '@/lib/with-md/ascii-diagram';
import type { CommentRecord, CommentSelectionDraft, CursorHint } from '@/lib/with-md/types';

interface Props {
  mdFileId: string;
  content: string;
  authToken: string;
  focusedComment: CommentRecord | null;
  focusRequestId: number;
  onContentChange(next: string): void;
  onSelectionDraftChange(next: CommentSelectionDraft | null): void;
  markRequest: { requestId: number; commentMarkId: string; from: number; to: number } | null;
  onMarkRequestApplied(requestId: number): void;
  cursorHint?: CursorHint;
  cursorHintKey?: number;
}

function getEditorMarkdown(editor: unknown): string | null {
  const fromMethod = (editor as { getMarkdown?: () => string }).getMarkdown?.();
  if (typeof fromMethod === 'string') return fromMethod;

  const fromStorage = (editor as { storage?: { markdown?: { getMarkdown?: () => string } } }).storage?.markdown?.getMarkdown?.();
  if (typeof fromStorage === 'string') return fromStorage;

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
): { from: number; to: number } | null {
  const markdown = getEditorMarkdown(editor) ?? '';
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
  const commands = editor.commands as unknown as {
    focus: () => boolean;
    setTextSelection: (value: { from: number; to: number }) => boolean;
  };
  commands.focus();
  commands.setTextSelection({ from, to });
  editor.view.dispatch(editor.state.tr.scrollIntoView());
}

export default function CollabEditor({
  mdFileId,
  content,
  authToken,
  focusedComment,
  focusRequestId,
  onContentChange,
  onSelectionDraftChange,
  markRequest,
  onMarkRequestApplied,
  cursorHint,
  cursorHintKey,
}: Props) {
  const realtimeRequested = process.env.NEXT_PUBLIC_WITHMD_ENABLE_REALTIME === '1';
  const realtimeExperimental = process.env.NEXT_PUBLIC_WITHMD_ENABLE_REALTIME_EXPERIMENTAL === '1';
  const enableRealtime = realtimeRequested && realtimeExperimental;

  const { ydoc, provider, connected, reason } = useCollabDoc({
    mdFileId,
    token: authToken,
    enabled: enableRealtime,
  });
  const lastLocalMarkdownRef = useRef<string | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    editorProps: {
      attributes: { class: 'withmd-prose' },
    },
    extensions: buildEditorExtensions({
      ydoc,
      provider,
      user: { name: 'withmd-user', color: '#c7d2fe' },
      enableRealtime,
    }),
    contentType: 'markdown',
    content,
    onUpdate({ editor: nextEditor }) {
      const markdown = getEditorMarkdown(nextEditor);
      if (markdown == null) return;
      lastLocalMarkdownRef.current = markdown;
      onContentChange(markdown);
    },
    onSelectionUpdate({ editor: nextEditor }) {
      const { from, to, empty } = nextEditor.state.selection;
      if (empty) {
        onSelectionDraftChange(null);
        return;
      }

      const textQuote = nextEditor.state.doc.textBetween(from, to, '\n', '\n').trim();
      if (!textQuote) {
        onSelectionDraftChange(null);
        return;
      }

      const markdown = getEditorMarkdown(nextEditor) ?? content;
      const matches = findAllIndices(markdown, textQuote);
      const rangeStart = matches[0];
      const rangeEnd = typeof rangeStart === 'number' ? rangeStart + textQuote.length : undefined;
      const fallbackLine = typeof rangeStart === 'number' ? lineNumberAtIndex(markdown, rangeStart) : 1;
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
    if (!editor) return;
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
  }, [content, editor]);

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

    editor.view.dom.addEventListener('paste', onPaste);
    return () => {
      editor.view.dom.removeEventListener('paste', onPaste);
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

    const { commentMarkId, textQuote, rangeStart } = focusedComment.anchor;
    const markedRange = commentMarkId ? findMarkedRangeInDoc(editor.state.doc, commentMarkId) : null;
    const fallbackRange = !markedRange && textQuote.trim()
      ? findQuoteRangeInEditorDom(editor, textQuote, rangeStart)
      : null;
    const target = markedRange ?? fallbackRange;
    if (!target) return;

    focusEditorRange(editor, target.from, target.to);
  }, [editor, focusRequestId, focusedComment]);

  const lastAppliedKeyRef = useRef<number>(-1);
  useEffect(() => {
    if (!editor || !cursorHint || typeof cursorHintKey !== 'number') return;
    if (cursorHintKey === lastAppliedKeyRef.current) return;
    lastAppliedKeyRef.current = cursorHintKey;

    const { textFragment, sourceLine, offsetInFragment } = cursorHint;
    const commands = editor.commands as unknown as {
      focus: () => boolean;
      setTextSelection: (pos: number) => boolean;
    };

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
          commands.focus();
          commands.setTextSelection(targetPos);
          return;
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
      commands.focus();
      commands.setTextSelection(Math.min(targetPos, editor.state.doc.content.size));
      return;
    }

    // No hint: just focus the editor
    commands.focus();
  }, [editor, cursorHint, cursorHintKey]);

  if (!editor) {
    return <p className="withmd-muted-sm">Loading editor...</p>;
  }

  if (realtimeRequested && !realtimeExperimental) {
    return (
      <div className="withmd-column withmd-fill withmd-gap-2">
        <div className="withmd-prosemirror-wrap withmd-editor-scroll withmd-fill">
          <EditorContent editor={editor} />
        </div>
      </div>
    );
  }

  const showStatus = enableRealtime && !connected && reason;

  return (
    <div className="withmd-column withmd-fill withmd-gap-2">
      {showStatus && <div className="withmd-muted-xs">{reason}</div>}
      <div className="withmd-prosemirror-wrap withmd-editor-scroll withmd-fill">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
