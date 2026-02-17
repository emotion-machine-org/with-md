'use client';

interface Props {
  visible: boolean;
  processing: boolean;
  fileCount?: number;
  idleTitle?: string;
  idleSubtitle?: string;
  processingTitle?: string;
  processingSubtitle?: string;
}

export default function ImportDropOverlay({
  visible,
  processing,
  fileCount = 0,
  idleTitle = 'Drag & drop markdown files here',
  idleSubtitle = 'Drop anywhere to import into repo root.',
  processingTitle = 'Importing markdown files...',
  processingSubtitle,
}: Props) {
  if (!visible) return null;

  const subtitle = processing
    ? (processingSubtitle ?? `Processing ${fileCount} file${fileCount === 1 ? '' : 's'}.`)
    : idleSubtitle;

  return (
    <div className="withmd-import-overlay" role="status" aria-live="polite">
      <div className={`withmd-import-overlay-frame ${processing ? 'is-processing' : ''}`}>
        <p className="withmd-import-overlay-title">
          {processing ? processingTitle : idleTitle}
        </p>
        <p className="withmd-import-overlay-sub">{subtitle}</p>
      </div>
    </div>
  );
}
