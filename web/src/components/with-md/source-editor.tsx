'use client';

interface Props {
  value: string;
  isDirty: boolean;
  isSaving: boolean;
  canApply: boolean;
  onChange(next: string): void;
  onApply(): void;
  onSave(): void;
  onDiscard(): void;
}

export default function SourceEditor({
  value,
  isDirty,
  isSaving,
  canApply,
  onChange,
  onApply,
  onSave,
  onDiscard,
}: Props) {
  return (
    <div className="withmd-column withmd-fill withmd-gap-3">
      <div className="withmd-row withmd-wrap withmd-gap-2">
        <button type="button" className="withmd-btn" onClick={onApply} disabled={!canApply || !isDirty}>
          Apply to Edit Doc
        </button>
        <button type="button" className="withmd-btn withmd-btn-primary" onClick={onSave} disabled={!isDirty || isSaving}>
          {isSaving ? 'Saving...' : 'Save Source'}
        </button>
        <button type="button" className="withmd-btn" onClick={onDiscard} disabled={!isDirty}>
          Discard
        </button>
      </div>

      <textarea
        className="withmd-source-editor"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
      />
    </div>
  );
}
