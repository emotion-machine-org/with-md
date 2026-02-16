'use client';

interface Props {
  visible: boolean;
  processing: boolean;
  fileCount?: number;
}

export default function ImportDropOverlay({ visible, processing, fileCount = 0 }: Props) {
  if (!visible) return null;

  return (
    <div className="withmd-import-overlay" role="status" aria-live="polite">
      <div className={`withmd-import-overlay-frame ${processing ? 'is-processing' : ''}`}>
        <p className="withmd-import-overlay-title">
          {processing ? 'Importing markdown files...' : 'Drag & drop markdown files here'}
        </p>
        <p className="withmd-import-overlay-sub">
          {processing
            ? `Processing ${fileCount} file${fileCount === 1 ? '' : 's'}.`
            : 'Drop anywhere to import into repo root.'}
        </p>
      </div>
    </div>
  );
}
