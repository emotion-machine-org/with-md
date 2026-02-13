'use client';

import type { DocMode } from '@/lib/with-md/types';

interface Props {
  mode: DocMode;
  canUseEditMode: boolean;
  syntaxReasons: string[];
  statusMessage: string | null;
  collabActive: boolean;
  onModeChange(next: DocMode): void;
  onPush(): void;
  onResync(): void;
}

function modeClass(active: boolean): string {
  return active ? 'withmd-dock-btn withmd-dock-btn-active' : 'withmd-dock-btn';
}

function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  const next = current === 'light' ? 'dark' : 'light';
  html.setAttribute('data-theme', next);
  try {
    localStorage.setItem('withmd-theme', next);
  } catch (e) {
    /* noop */
  }
}

export default function DocumentToolbar({
  mode,
  canUseEditMode,
  syntaxReasons,
  statusMessage,
  collabActive,
  onModeChange,
  onPush,
  onResync,
}: Props) {
  return (
    <header className="withmd-dock-wrap">
      <div className="withmd-dock">
        <div className="withmd-row" style={{ gap: 2 }}>
          <button type="button" className={modeClass(mode === 'read')} onClick={() => onModeChange('read')} aria-label="Read">
            <ReadIcon />
            <span className="withmd-dock-tooltip">Read</span>
          </button>
          <button
            type="button"
            className={modeClass(mode === 'edit')}
            onClick={() => onModeChange('edit')}
            disabled={!canUseEditMode}
            aria-label="Edit"
          >
            <EditIcon />
            <span className="withmd-dock-tooltip">Edit</span>
          </button>
          <button type="button" className={modeClass(mode === 'source')} onClick={() => onModeChange('source')} aria-label="Source">
            <CodeIcon />
            <span className="withmd-dock-tooltip">Source</span>
          </button>
        </div>

        <span className="withmd-dock-gap" />

        <div className="withmd-row" style={{ gap: 2 }}>
          <button type="button" className="withmd-dock-btn" onClick={onResync} aria-label="Re-sync">
            <SyncIcon />
            <span className="withmd-dock-tooltip">Re-sync</span>
          </button>
          <button type="button" className="withmd-dock-btn withmd-dock-btn-primary" onClick={onPush} aria-label="Push">
            <PushIcon />
            <span className="withmd-dock-tooltip">Push</span>
          </button>
        </div>

        <span className="withmd-dock-gap" />

        <button type="button" className="withmd-dock-btn" onClick={toggleTheme} aria-label="Toggle theme">
          <SunIcon />
          <MoonIcon />
          <span className="withmd-dock-tooltip">Theme</span>
        </button>
      </div>

      {!canUseEditMode && (
        <p className="withmd-warning withmd-mt-2 withmd-dock-note">
          Rich edit disabled due to unsupported syntax: {syntaxReasons.join(', ')}.
        </p>
      )}

      {statusMessage && (
        <div className="withmd-row withmd-gap-2 withmd-mt-2 withmd-dock-meta">
          <span className="withmd-muted-xs withmd-dock-status">{statusMessage}</span>
        </div>
      )}
    </header>
  );
}

function ReadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 17.5V21h3.5L19 8.5 15.5 5 3 17.5zm17.7-10.8a1 1 0 0 0 0-1.4l-2-2a1 1 0 0 0-1.4 0l-1.2 1.2 3.5 3.5 1.1-1.2z" />
    </svg>
  );
}

function CodeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.7 16.6 4.1 12l4.6-4.6 1.4 1.4L6.9 12l3.2 3.2-1.4 1.4zm6.6 0-1.4-1.4 3.2-3.2-3.2-3.2 1.4-1.4 4.6 4.6-4.6 4.6z" />
    </svg>
  );
}

function SyncIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 6V3L8 7l4 4V8c2.8 0 5 2.2 5 5 0 .7-.2 1.4-.4 2l1.5 1.5c.6-1 1-2.2 1-3.5 0-3.9-3.1-7-7-7zm-5 5c0-.7.2-1.4.4-2L5.9 7.5C5.3 8.5 5 9.7 5 11c0 3.9 3.1 7 7 7v3l4-4-4-4v3c-2.8 0-5-2.2-5-5z" />
    </svg>
  );
}

function PushIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 7 8h3v6h4V8h3l-5-5zm-7 14v4h14v-4h2v6H3v-6h2z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg className="withmd-icon-sun" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 18a6 6 0 1 1 0-12 6 6 0 0 1 0 12zm0-2a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM11 1h2v3h-2V1zm0 19h2v3h-2v-3zM3.515 4.929l1.414-1.414L7.05 5.636 5.636 7.05 3.515 4.93zM16.95 18.364l1.414-1.414 2.121 2.121-1.414 1.414-2.121-2.121zm2.121-14.85 1.414 1.415-2.121 2.121-1.414-1.414 2.121-2.121zM5.636 16.95l1.414 1.414-2.121 2.121-1.414-1.414 2.121-2.121zM23 11v2h-3v-2h3zM4 11v2H1v-2h3z" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg className="withmd-icon-moon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10 7a7 7 0 0 0 12 4.9v.1c0 5.523-4.477 10-10 10S2 17.523 2 12 6.477 2 12 2h.1A6.98 6.98 0 0 0 10 7zm-6 5a8 8 0 0 0 15.062 3.762A9 9 0 0 1 8.238 4.938 7.999 7.999 0 0 0 4 12z" />
    </svg>
  );
}
