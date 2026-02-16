'use client';

import type { Editor } from '@tiptap/core';
import { useCallback, useState } from 'react';

interface Props {
  editor: Editor;
}

export default function FormatToolbar({ editor }: Props) {
  const [linkInput, setLinkInput] = useState('');
  const [showLinkInput, setShowLinkInput] = useState(false);

  const toggle = useCallback(
    (command: string, attrs?: Record<string, unknown>) => {
      const chain = editor.chain().focus() as Record<string, (...args: unknown[]) => unknown>;
      const fn = chain[command];
      if (typeof fn === 'function') {
        (fn.call(chain, attrs) as { run: () => void }).run();
      }
    },
    [editor],
  );

  const setHeading = useCallback(
    (level: number) => {
      (
        editor.chain().focus() as unknown as {
          toggleHeading: (attrs: { level: number }) => { run: () => void };
        }
      )
        .toggleHeading({ level })
        .run();
    },
    [editor],
  );

  const setLink = useCallback(() => {
    if (!linkInput.trim()) {
      (editor.chain().focus() as unknown as { unsetLink: () => { run: () => void } })
        .unsetLink()
        .run();
      setShowLinkInput(false);
      setLinkInput('');
      return;
    }
    (
      editor.chain().focus() as unknown as {
        extendMarkRange: (name: string) => {
          setLink: (attrs: { href: string }) => { run: () => void };
        };
      }
    )
      .extendMarkRange('link')
      .setLink({ href: linkInput.trim() })
      .run();
    setShowLinkInput(false);
    setLinkInput('');
  }, [editor, linkInput]);

  const openLinkInput = useCallback(() => {
    const existing = editor.getAttributes('link').href as string | undefined;
    setLinkInput(existing ?? '');
    setShowLinkInput(true);
  }, [editor]);

  const isActive = (name: string, attrs?: Record<string, unknown>) => editor.isActive(name, attrs);

  return (
    <div className="withmd-fmt-bar">
      <button
        type="button"
        className={fmtClass(isActive('bold'))}
        onClick={() => toggle('toggleBold')}
        aria-label="Bold"
      >
        <BoldIcon />
        <span className="withmd-dock-tooltip">Bold</span>
      </button>
      <button
        type="button"
        className={fmtClass(isActive('italic'))}
        onClick={() => toggle('toggleItalic')}
        aria-label="Italic"
      >
        <ItalicIcon />
        <span className="withmd-dock-tooltip">Italic</span>
      </button>
      <button
        type="button"
        className={fmtClass(isActive('underline'))}
        onClick={() => toggle('toggleUnderline')}
        aria-label="Underline"
      >
        <UnderlineIcon />
        <span className="withmd-dock-tooltip">Underline</span>
      </button>
      <button
        type="button"
        className={fmtClass(isActive('strike'))}
        onClick={() => toggle('toggleStrike')}
        aria-label="Strikethrough"
      >
        <StrikeIcon />
        <span className="withmd-dock-tooltip">Strikethrough</span>
      </button>
      <button
        type="button"
        className={fmtClass(isActive('code'))}
        onClick={() => toggle('toggleCode')}
        aria-label="Inline code"
      >
        <InlineCodeIcon />
        <span className="withmd-dock-tooltip">Code</span>
      </button>

      <span className="withmd-fmt-sep" />

      <button
        type="button"
        className={fmtClass(isActive('heading', { level: 1 }))}
        onClick={() => setHeading(1)}
        aria-label="Heading 1"
      >
        <span className="withmd-fmt-label">H1</span>
        <span className="withmd-dock-tooltip">Heading 1</span>
      </button>
      <button
        type="button"
        className={fmtClass(isActive('heading', { level: 2 }))}
        onClick={() => setHeading(2)}
        aria-label="Heading 2"
      >
        <span className="withmd-fmt-label">H2</span>
        <span className="withmd-dock-tooltip">Heading 2</span>
      </button>
      <button
        type="button"
        className={fmtClass(isActive('heading', { level: 3 }))}
        onClick={() => setHeading(3)}
        aria-label="Heading 3"
      >
        <span className="withmd-fmt-label">H3</span>
        <span className="withmd-dock-tooltip">Heading 3</span>
      </button>

      <span className="withmd-fmt-sep" />

      <button
        type="button"
        className={fmtClass(isActive('bulletList'))}
        onClick={() => toggle('toggleBulletList')}
        aria-label="Bullet list"
      >
        <BulletListIcon />
        <span className="withmd-dock-tooltip">Bullet List</span>
      </button>
      <button
        type="button"
        className={fmtClass(isActive('orderedList'))}
        onClick={() => toggle('toggleOrderedList')}
        aria-label="Ordered list"
      >
        <OrderedListIcon />
        <span className="withmd-dock-tooltip">Ordered List</span>
      </button>
      <button
        type="button"
        className={fmtClass(isActive('blockquote'))}
        onClick={() => toggle('toggleBlockquote')}
        aria-label="Blockquote"
      >
        <BlockquoteIcon />
        <span className="withmd-dock-tooltip">Blockquote</span>
      </button>
      <button
        type="button"
        className={fmtClass(isActive('codeBlock'))}
        onClick={() => toggle('toggleCodeBlock')}
        aria-label="Code block"
      >
        <CodeBlockIcon />
        <span className="withmd-dock-tooltip">Code Block</span>
      </button>

      <span className="withmd-fmt-sep" />

      <button
        type="button"
        className={fmtClass(isActive('link'))}
        onClick={openLinkInput}
        aria-label="Link"
      >
        <LinkIcon />
        <span className="withmd-dock-tooltip">Link</span>
      </button>
      <button
        type="button"
        className="withmd-fmt-btn"
        onClick={() => toggle('setHorizontalRule')}
        aria-label="Horizontal rule"
      >
        <HrIcon />
        <span className="withmd-dock-tooltip">Horizontal Rule</span>
      </button>

      {showLinkInput && (
        <div className="withmd-fmt-link-popover">
          <input
            className="withmd-fmt-link-input"
            type="url"
            placeholder="https://..."
            value={linkInput}
            onChange={(e) => setLinkInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                setLink();
              }
              if (e.key === 'Escape') {
                setShowLinkInput(false);
                setLinkInput('');
              }
            }}
            autoFocus
          />
          <button type="button" className="withmd-fmt-link-ok" onClick={setLink}>
            {linkInput.trim() ? 'Set' : 'Remove'}
          </button>
          <button
            type="button"
            className="withmd-fmt-link-cancel"
            onClick={() => {
              setShowLinkInput(false);
              setLinkInput('');
            }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function fmtClass(active: boolean): string {
  return active ? 'withmd-fmt-btn withmd-fmt-btn-active' : 'withmd-fmt-btn';
}

/* ── Icons ── */

function BoldIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 11h4.5a2.5 2.5 0 0 0 0-5H8v5zm10 4.5a4.5 4.5 0 0 1-4.5 4.5H6V4h6.5a4.5 4.5 0 0 1 3.256 7.606A4.5 4.5 0 0 1 18 15.5zM8 13v5h5.5a2.5 2.5 0 0 0 0-5H8z" />
    </svg>
  );
}

function ItalicIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15 20H7v-2h2.927l2.116-12H10V4h8v2h-2.927l-2.116 12H15v2z" />
    </svg>
  );
}

function UnderlineIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 3v9a4 4 0 0 0 8 0V3h2v9a6 6 0 0 1-12 0V3h2zM4 20h16v2H4v-2z" />
    </svg>
  );
}

function StrikeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M17.154 14c.23.516.346 1.09.346 1.72 0 1.342-.524 2.392-1.571 3.147C14.88 19.622 13.433 20 11.586 20c-1.64 0-3.263-.381-4.868-1.144V16.6c1.52.877 3.075 1.316 4.666 1.316 2.551 0 3.83-.732 3.839-2.197a2.21 2.21 0 0 0-.648-1.603l-.12-.116H3v-2h18v2h-3.846zM7.556 11H4V9h2.401C6.14 8.538 6 8.017 6 7.44c0-1.26.52-2.27 1.56-3.027C8.6 3.804 9.98 3.424 11.7 3.424c1.481 0 2.9.322 4.258.966v2.148c-1.382-.743-2.8-1.114-4.258-1.114-1.16 0-2.07.207-2.73.621-.66.414-.99.945-.99 1.593 0 .556.178 1.026.534 1.41.135.147.304.293.505.437l.534.374.31.202-.307.939z" />
    </svg>
  );
}

function InlineCodeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M24 12l-5.657 5.657-1.414-1.414L21.172 12l-4.243-4.243 1.414-1.414L24 12zM2.828 12l4.243 4.243-1.414 1.414L0 12l5.657-5.657L7.07 7.757 2.828 12zm6.96 9H7.66l6.552-18h2.128L9.788 21z" />
    </svg>
  );
}

function BulletListIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 4h13v2H8V4zM4.5 6.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm0 7a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm0 6.9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM8 11h13v2H8v-2zm0 7h13v2H8v-2z" />
    </svg>
  );
}

function OrderedListIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 4h13v2H8V4zM5 3v3H4V4H3V3h2zm-1 8h2.5v1H3v-1l2-2H3V8h3v1L4 11zm-1 6.5v-1H5v-.5H3v-1h3v3.5H3v-1h2v-.5H3zM8 11h13v2H8v-2zm0 7h13v2H8v-2z" />
    </svg>
  );
}

function BlockquoteIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4.583 17.321C3.553 16.227 3 15 3 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311C9.591 11.69 11 13.2 11 15c0 1.933-1.567 3.5-3.5 3.5-1.29 0-2.405-.56-2.917-1.179zm10 0C13.553 16.227 13 15 13 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311C19.591 11.69 21 13.2 21 15c0 1.933-1.567 3.5-3.5 3.5-1.29 0-2.405-.56-2.917-1.179z" />
    </svg>
  );
}

function CodeBlockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 3h18a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm1 2v14h16V5H4zm16 7-3.536 3.536-1.414-1.414L17.172 12l-2.122-2.122 1.414-1.414L20 12zM6.828 12l2.122 2.122-1.414 1.414L4 12l3.536-3.536 1.414 1.414L6.828 12z" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18.364 15.536 16.95 14.12l1.414-1.414a5 5 0 1 0-7.071-7.071L9.879 7.05 8.464 5.636 9.88 4.222a7 7 0 0 1 9.9 9.9l-1.415 1.414zm-2.828 2.828-1.415 1.414a7 7 0 0 1-9.9-9.9l1.415-1.414L7.05 9.88l-1.414 1.414a5 5 0 1 0 7.071 7.071l1.414-1.414 1.415 1.414zm-.708-10.607 1.415 1.415-7.071 7.07-1.415-1.414 7.071-7.07z" />
    </svg>
  );
}

function HrIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 11h2v2H2v-2zm4 0h12v2H6v-2zm14 0h2v2h-2v-2z" />
    </svg>
  );
}
