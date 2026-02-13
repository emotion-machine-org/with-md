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
        <div className="withmd-row withmd-gap-2">
          <button type="button" className={modeClass(mode === 'read')} onClick={() => onModeChange('read')}>
            <ReadIcon />
            <span>Read</span>
          </button>
          <button
            type="button"
            className={modeClass(mode === 'edit')}
            onClick={() => onModeChange('edit')}
            disabled={!canUseEditMode}
          >
            <EditIcon />
            <span>Edit</span>
          </button>
          <button type="button" className={modeClass(mode === 'source')} onClick={() => onModeChange('source')}>
            <CodeIcon />
            <span>Source</span>
          </button>
        </div>

        <span className="withmd-dock-divider" />

        <div className="withmd-row withmd-gap-2">
          <button type="button" className="withmd-dock-btn" onClick={onResync}>
            <SyncIcon />
            Re-sync
          </button>
          <button type="button" className="withmd-dock-btn withmd-dock-btn-primary" onClick={onPush}>
            <PushIcon />
            Push to GitHub
          </button>
        </div>
      </div>

      {!canUseEditMode && (
        <p className="withmd-warning withmd-mt-2 withmd-dock-note">
          Rich edit disabled due to unsupported syntax: {syntaxReasons.join(', ')}.
        </p>
      )}

      <div className="withmd-row withmd-gap-2 withmd-mt-2 withmd-dock-meta">
        <span className={collabActive ? 'withmd-dot withmd-dot-online' : 'withmd-dot withmd-dot-offline'} />
        <span className="withmd-muted-xs">{collabActive ? 'Live collaboration active' : 'Read-only standby'}</span>
        {statusMessage && <span className="withmd-muted-xs withmd-dock-status">{statusMessage}</span>}
      </div>
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
