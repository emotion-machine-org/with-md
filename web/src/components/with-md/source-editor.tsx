'use client';

import type { CSSProperties } from 'react';

import { useScrollbarWidth } from '@/hooks/with-md/use-scrollbar-width';

interface Props {
  value: string;
  onChange(next: string): void;
}

export default function SourceEditor({ value, onChange }: Props) {
  const { ref: textareaRef, scrollbarWidth } = useScrollbarWidth<HTMLTextAreaElement>();

  return (
    <textarea
      ref={textareaRef}
      className="withmd-source-editor withmd-editor-scroll"
      style={{ '--withmd-editor-scrollbar-width': `${scrollbarWidth}px` } as CSSProperties}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      spellCheck={false}
    />
  );
}
