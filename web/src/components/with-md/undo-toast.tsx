'use client';

interface Props {
  visible: boolean;
  message: string;
  secondsLeft: number;
  onUndo(): void;
  onDismiss(): void;
}

export default function UndoToast({ visible, message, secondsLeft, onUndo, onDismiss }: Props) {
  if (!visible) return null;

  return (
    <div className="withmd-undo-toast" role="status" aria-live="polite">
      <p className="withmd-undo-toast-text">{message}</p>
      <p className="withmd-undo-toast-meta">Undo in {Math.max(0, secondsLeft)}s (Cmd/Ctrl+Z)</p>
      <div className="withmd-row withmd-gap-2">
        <button type="button" className="withmd-btn" onClick={onDismiss}>
          Dismiss
        </button>
        <button type="button" className="withmd-btn withmd-btn-primary" onClick={onUndo}>
          Undo
        </button>
      </div>
    </div>
  );
}
