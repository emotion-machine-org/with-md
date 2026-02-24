'use client';

export interface PushCommitRow {
  path: string;
  selected: boolean;
  isDelete: boolean;
}

interface Props {
  open: boolean;
  rows: PushCommitRow[];
  commitMessage: string;
  busy: boolean;
  onToggle(path: string): void;
  onToggleAll(): void;
  onCommitMessageChange(message: string): void;
  onPush(): void;
  onCancel(): void;
}

export default function PushCommitSheet({
  open,
  rows,
  commitMessage,
  busy,
  onToggle,
  onToggleAll,
  onCommitMessageChange,
  onPush,
  onCancel,
}: Props) {
  if (!open) return null;

  const selectedCount = rows.filter((r) => r.selected).length;
  const allChecked = rows.length > 0 && selectedCount === rows.length;

  return (
    <div className="withmd-push-commit-backdrop" role="dialog" aria-modal="true" aria-label="Push to GitHub">
      <div className="withmd-push-commit-panel">
        <div className="withmd-push-commit-head">
          <h3 className="withmd-push-commit-title">Push to GitHub</h3>
          <p className="withmd-push-commit-sub">
            {rows.length} file{rows.length === 1 ? '' : 's'} queued for push.
            Select which files to include.
          </p>
        </div>

        <div className="withmd-push-commit-table-wrap">
          <table className="withmd-push-commit-table">
            <thead>
              <tr>
                <th className="withmd-push-commit-checkbox-col">
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
                  <td className="withmd-push-commit-checkbox-col">
                    <input
                      type="checkbox"
                      className="withmd-modal-checkbox"
                      checked={row.selected}
                      onChange={() => onToggle(row.path)}
                      disabled={busy}
                    />
                  </td>
                  <td className="withmd-push-commit-path">{row.path}</td>
                  <td>
                    <span className={`withmd-push-commit-pill ${row.isDelete ? 'is-delete' : 'is-update'}`}>
                      {row.isDelete ? 'delete' : 'update'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="withmd-push-commit-message-wrap">
          <label className="withmd-push-commit-message-label" htmlFor="push-commit-message">
            Commit message
          </label>
          <textarea
            id="push-commit-message"
            className="withmd-push-commit-message"
            value={commitMessage}
            onChange={(e) => onCommitMessageChange(e.target.value)}
            disabled={busy}
            rows={3}
            placeholder="Enter a commit message..."
          />
        </div>

        <div className="withmd-push-commit-actions">
          <button
            type="button"
            className="withmd-btn"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="withmd-btn withmd-btn-primary"
            onClick={onPush}
            disabled={busy || selectedCount === 0}
          >
            {busy ? 'Pushing...' : `Push ${selectedCount} file${selectedCount === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
