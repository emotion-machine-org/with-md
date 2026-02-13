'use client';

interface Props {
  connected: boolean;
  reason?: string | null;
}

export default function PresenceStrip({ connected, reason }: Props) {
  return (
    <div className="withmd-row withmd-gap-2 withmd-muted-xs">
      <span className={connected ? 'withmd-dot withmd-dot-online' : 'withmd-dot withmd-dot-offline'} />
      <span>{connected ? 'Collaboration connected' : reason ?? 'Collaboration offline'}</span>
    </div>
  );
}
