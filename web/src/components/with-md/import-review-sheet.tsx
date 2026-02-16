'use client';

import type { ImportConflictMode } from '@/lib/with-md/types';

export interface ImportReviewRow {
  id: string;
  sourceName: string;
  targetPath: string;
  conflictMode: ImportConflictMode;
  hasExistingConflict: boolean;
  isValid: boolean;
}

interface Props {
  open: boolean;
  rows: ImportReviewRow[];
  busy: boolean;
  onUpdateRow(id: string, patch: Partial<Pick<ImportReviewRow, 'targetPath' | 'conflictMode'>>): void;
  onCancel(): void;
  onSubmit(): void;
}

function rowStatus(row: ImportReviewRow): string {
  if (!row.isValid) return 'invalid';
  if (!row.hasExistingConflict) return 'new';
  return row.conflictMode === 'replace' ? 'replace' : 'keep both';
}

export default function ImportReviewSheet({
  open,
  rows,
  busy,
  onUpdateRow,
  onCancel,
  onSubmit,
}: Props) {
  if (!open) return null;

  const validCount = rows.filter((row) => row.isValid).length;

  return (
    <div className="withmd-import-review-backdrop" role="dialog" aria-modal="true" aria-label="Import markdown files">
      <div className="withmd-import-review-panel">
        <div className="withmd-import-review-head">
          <h3 className="withmd-import-review-title">Review Import</h3>
          <p className="withmd-import-review-sub">Adjust target paths, then import.</p>
        </div>

        <div className="withmd-import-review-table-wrap">
          <table className="withmd-import-review-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Target Path</th>
                <th>Conflict</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={row.isValid ? '' : 'is-invalid'}>
                  <td className="withmd-import-review-source">{row.sourceName}</td>
                  <td>
                    <input
                      className="withmd-import-path-input"
                      value={row.targetPath}
                      onChange={(event) => onUpdateRow(row.id, { targetPath: event.target.value })}
                      disabled={busy}
                    />
                  </td>
                  <td>
                    <select
                      className="withmd-import-mode-select"
                      value={row.conflictMode}
                      onChange={(event) => onUpdateRow(row.id, { conflictMode: event.target.value as ImportConflictMode })}
                      disabled={busy}
                    >
                      <option value="keep_both">Keep both</option>
                      <option value="replace">Replace</option>
                    </select>
                  </td>
                  <td>
                    <span className="withmd-import-status-pill">{rowStatus(row)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="withmd-import-review-actions">
          <button
            type="button"
            className="withmd-import-action-btn withmd-import-action-cancel"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="withmd-import-action-btn withmd-import-action-submit"
            onClick={onSubmit}
            disabled={busy || validCount === 0}
          >
            {busy ? 'Importing...' : `Import ${validCount} file${validCount === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
