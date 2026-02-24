'use client';

export interface ResyncConflictRow {
  path: string;
  overwrite: boolean;
}

interface Props {
  open: boolean;
  rows: ResyncConflictRow[];
  busy: boolean;
  onToggle(path: string): void;
  onToggleAll(): void;
  onOverwrite(): void;
  onKeepAll(): void;
}

export default function ResyncConflictSheet({
  open,
  rows,
  busy,
  onToggle,
  onToggleAll,
  onOverwrite,
  onKeepAll,
}: Props) {
  if (!open) return null;

  const overwriteCount = rows.filter((r) => r.overwrite).length;
  const allChecked = rows.length > 0 && overwriteCount === rows.length;

  return (
    <div className="withmd-resync-conflict-backdrop" role="dialog" aria-modal="true" aria-label="Resync conflicts">
      <div className="withmd-resync-conflict-panel">
        <div className="withmd-resync-conflict-head">
          <h3 className="withmd-resync-conflict-title">Sync Conflicts</h3>
          <p className="withmd-resync-conflict-sub">
            {rows.length} file{rows.length === 1 ? '' : 's'} had local edits that differ from GitHub.
            Choose which to overwrite with the GitHub version.
          </p>
        </div>

        <div className="withmd-resync-conflict-table-wrap">
          <table className="withmd-resync-conflict-table">
            <thead>
              <tr>
                <th className="withmd-resync-conflict-checkbox-col">
                  <input
                    type="checkbox"
                    className="withmd-modal-checkbox"
                    checked={allChecked}
                    onChange={onToggleAll}
                    disabled={busy}
                    aria-label="Toggle all"
                  />
                </th>
                <th>File</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.path}>
                  <td className="withmd-resync-conflict-checkbox-col">
                    <input
                      type="checkbox"
                      className="withmd-modal-checkbox"
                      checked={row.overwrite}
                      onChange={() => onToggle(row.path)}
                      disabled={busy}
                    />
                  </td>
                  <td className="withmd-resync-conflict-path">{row.path}</td>
                  <td>
                    <span className={`withmd-resync-conflict-pill ${row.overwrite ? 'is-overwrite' : 'is-keep'}`}>
                      {row.overwrite ? 'overwrite' : 'keep local'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="withmd-resync-conflict-actions">
          <button
            type="button"
            className="withmd-btn"
            onClick={onKeepAll}
            disabled={busy}
          >
            Keep All Local
          </button>
          <button
            type="button"
            className="withmd-btn withmd-btn-primary"
            onClick={onOverwrite}
            disabled={busy || overwriteCount === 0}
          >
            {busy ? 'Overwriting...' : `Overwrite ${overwriteCount} file${overwriteCount === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
