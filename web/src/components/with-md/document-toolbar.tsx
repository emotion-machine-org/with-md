'use client';

import type { UserMode } from '@/lib/with-md/types';

interface AuthUser {
  userId: string;
  githubLogin: string;
  avatarUrl?: string;
}

interface Props {
  userMode: UserMode;
  canUseRichEdit: boolean;
  syntaxReasons: string[];
  statusMessage: string | null;
  realtimeSafeModeMessage?: string | null;
  user?: AuthUser;
  peerCount?: number;
  formatBarOpen: boolean;
  onToggleFormatBar(): void;
  onUserModeChange(next: UserMode): void;
  onPush(): void;
  onResync(): void;
  onDownload?(): void;
  onLogout?(): void;
}

const SYNTAX_REASON_LABELS: Record<string, string> = {
  mdx_or_embedded_jsx: 'mdx_or_embedded_jsx',
  frontmatter: 'frontmatter',
  directives: 'directives',
  gfm_table: 'gfm_table',
};

const BG_COUNT = 12;

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

function cycleBackground() {
  let current = 0;
  try {
    current = parseInt(localStorage.getItem('withmd-bg') ?? '0', 10) || 0;
  } catch (e) {
    /* noop */
  }
  const next = (current + 1) % BG_COUNT;
  document.documentElement.setAttribute('data-bg', String(next));
  try {
    localStorage.setItem('withmd-bg', String(next));
  } catch (e) {
    /* noop */
  }
}

export default function DocumentToolbar({
  userMode,
  canUseRichEdit,
  syntaxReasons,
  statusMessage,
  realtimeSafeModeMessage,
  user,
  peerCount,
  formatBarOpen,
  onToggleFormatBar,
  onUserModeChange,
  onPush,
  onResync,
  onDownload,
  onLogout,
}: Props) {
  const syntaxLabel = syntaxReasons.map((reason) => SYNTAX_REASON_LABELS[reason] ?? reason).join(', ');
  const showFormatToggle = userMode === 'document';

  return (
    <header className="withmd-dock-wrap">
      <div className="withmd-dock">
        {showFormatToggle && (
          <button
            type="button"
            className={modeClass(formatBarOpen)}
            onClick={onToggleFormatBar}
            aria-label="Toggle formatting"
          >
            <FormatExpandIcon />
            <span className="withmd-dock-tooltip">Format</span>
          </button>
        )}
        <button
          type="button"
          className={modeClass(userMode === 'source')}
          onClick={() => onUserModeChange(userMode === 'source' ? 'document' : 'source')}
          aria-label="Source"
        >
          <CodeIcon />
          <span className="withmd-dock-tooltip">Source</span>
        </button>
        <button type="button" className="withmd-dock-btn" onClick={onResync} aria-label="Re-sync">
          <SyncIcon />
          <span className="withmd-dock-tooltip">Re-sync</span>
        </button>
        <button type="button" className="withmd-dock-btn" onClick={onPush} aria-label="Push">
          <PushIcon />
          <span className="withmd-dock-tooltip">Push</span>
        </button>
        <button type="button" className="withmd-dock-btn" onClick={onDownload} aria-label="Download">
          <DownloadIcon />
          <span className="withmd-dock-tooltip">Download</span>
        </button>
        <button type="button" className="withmd-dock-btn" onClick={cycleBackground} aria-label="Change background">
          <ImageIcon />
          <span className="withmd-dock-tooltip">Change Background</span>
        </button>
        <button type="button" className="withmd-dock-btn" onClick={toggleTheme} aria-label="Toggle theme">
          <SunIcon />
          <MoonIcon />
          <span className="withmd-dock-tooltip">Theme</span>
        </button>

        {user && (
          <>
            <span className="withmd-dock-gap" />
            <div className="withmd-row" style={{ gap: 6, alignItems: 'center' }}>
              {user.avatarUrl && (
                <span className="withmd-avatar-wrap">
                  <img
                    src={user.avatarUrl}
                    alt={user.githubLogin}
                    style={{ width: 22, height: 22, borderRadius: '50%' }}
                  />
                  {Boolean(peerCount) && <span className="withmd-avatar-online-dot" />}
                </span>
              )}
              <span className="withmd-muted-xs">{user.githubLogin}</span>
              {Boolean(peerCount) && (
                <span className="withmd-presence-badge">+{peerCount}</span>
              )}
              {onLogout && (
                <button type="button" className="withmd-dock-btn" onClick={onLogout} aria-label="Logout">
                  <LogoutIcon />
                  <span className="withmd-dock-tooltip">Logout</span>
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {!canUseRichEdit && (
        <p className="withmd-warning withmd-mt-2 withmd-dock-note">
          Rich edit disabled due to unsupported syntax: {syntaxLabel}.
        </p>
      )}

      {realtimeSafeModeMessage && (
        <p className="withmd-warning withmd-mt-2 withmd-dock-note">
          {realtimeSafeModeMessage}
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

function FormatExpandIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12.9 6.858l4.242 4.243L7.242 21H3v-4.243l9.9-9.9zm1.414-1.414l2.121-2.122a1 1 0 0 1 1.414 0l2.829 2.829a1 1 0 0 1 0 1.414l-2.122 2.121-4.242-4.242z" />
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

function ImageIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 13.5l2.5 3 3.5-4.5 4.5 6H5l3.5-5.5z" />
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

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M13 10H18L12 16L6 10H11V3H13V10ZM4 19H20V12H22V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V12H4V19Z" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 22a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v3h-2V4H6v16h12v-2h2v3a1 1 0 0 1-1 1H5zm13-6v-3H10v-2h8V8l5 4-5 4z" />
    </svg>
  );
}
