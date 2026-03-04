'use client';

export interface Notice {
  id: string;
  message: string;
  accent?: boolean;
  closable?: boolean;
}

interface Props {
  notices: Notice[];
  onDismiss(id: string): void;
}

export default function NoticeStack({ notices, onDismiss }: Props) {
  if (notices.length === 0) return null;

  return (
    <aside className="withmd-notice-stack" aria-live="polite">
      {notices.map((n) => (
        <section
          key={n.id}
          className={`withmd-notice${n.accent ? ' withmd-notice-accent' : ''}`}
        >
          <span>{n.message}</span>
          {n.closable !== false ? (
            <button
              type="button"
              className="withmd-notice-close"
              aria-label="Dismiss notice"
              onClick={() => onDismiss(n.id)}
            >
              ×
            </button>
          ) : null}
        </section>
      ))}
    </aside>
  );
}
