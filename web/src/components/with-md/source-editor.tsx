'use client';

interface Props {
  value: string;
  onChange(next: string): void;
}

export default function SourceEditor({ value, onChange }: Props) {
  return (
    <textarea
      className="withmd-source-editor"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      spellCheck={false}
    />
  );
}
