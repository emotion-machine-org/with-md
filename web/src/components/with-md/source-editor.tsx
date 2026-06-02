'use client';

import { useCallback, useLayoutEffect, useRef } from 'react';
import type { CSSProperties } from 'react';

import { useScrollbarWidth } from '@/hooks/with-md/use-scrollbar-width';

interface Props {
  value: string;
  onChange(next: string): void;
}

export default function SourceEditor({ value, onChange }: Props) {
  const textareaNodeRef = useRef<HTMLTextAreaElement | null>(null);
  const selectionRef = useRef<{ start: number; end: number; direction: 'forward' | 'backward' | 'none'; scrollTop: number; scrollLeft: number } | null>(null);
  const { ref: scrollbarRef, scrollbarWidth } = useScrollbarWidth<HTMLTextAreaElement>();

  const rememberSelection = useCallback(() => {
    const textarea = textareaNodeRef.current;
    if (!textarea) return;
    selectionRef.current = {
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
      direction: textarea.selectionDirection,
      scrollTop: textarea.scrollTop,
      scrollLeft: textarea.scrollLeft,
    };
  }, []);

  const setTextareaRef = useCallback((node: HTMLTextAreaElement | null) => {
    textareaNodeRef.current = node;
    scrollbarRef(node);
  }, [scrollbarRef]);

  useLayoutEffect(() => {
    const textarea = textareaNodeRef.current;
    const selection = selectionRef.current;
    if (!textarea || !selection || document.activeElement !== textarea) return;

    const start = Math.min(selection.start, value.length);
    const end = Math.min(selection.end, value.length);
    textarea.setSelectionRange(start, end, selection.direction);
    textarea.scrollTop = selection.scrollTop;
    textarea.scrollLeft = selection.scrollLeft;
  }, [value]);

  return (
    <textarea
      ref={setTextareaRef}
      className="withmd-source-editor withmd-editor-scroll"
      style={{ '--withmd-editor-scrollbar-width': `${scrollbarWidth}px` } as CSSProperties}
      value={value}
      onChange={(event) => {
        rememberSelection();
        onChange(event.target.value);
      }}
      onClick={rememberSelection}
      onKeyUp={rememberSelection}
      onSelect={rememberSelection}
      onScroll={rememberSelection}
      spellCheck={false}
    />
  );
}
