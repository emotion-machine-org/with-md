'use client';

import CollabEditor from '@/components/with-md/collab-editor';
import ReadRenderer from '@/components/with-md/read-renderer';
import SourceEditor from '@/components/with-md/source-editor';
import type { DocMode } from '@/lib/with-md/types';

interface Props {
  mdFileId: string;
  mode: DocMode;
  readContent: string;
  sourceValue: string;
  sourceDirty: boolean;
  sourceSaving: boolean;
  canApplySource: boolean;
  onSourceChange(next: string): void;
  onApplySource(): void;
  onSaveSource(): void;
  onDiscardSource(): void;
  onEditorContentChange(next: string): void;
}

export default function DocumentSurface({
  mdFileId,
  mode,
  readContent,
  sourceValue,
  sourceDirty,
  sourceSaving,
  canApplySource,
  onSourceChange,
  onApplySource,
  onSaveSource,
  onDiscardSource,
  onEditorContentChange,
}: Props) {
  if (mode === 'source') {
    return (
      <SourceEditor
        value={sourceValue}
        isDirty={sourceDirty}
        isSaving={sourceSaving}
        canApply={canApplySource}
        onChange={onSourceChange}
        onApply={onApplySource}
        onSave={onSaveSource}
        onDiscard={onDiscardSource}
      />
    );
  }

  if (mode === 'edit') {
    return (
      <CollabEditor
        mdFileId={mdFileId}
        content={readContent}
        authToken="local-dev-token"
        onContentChange={onEditorContentChange}
      />
    );
  }

  return (
    <div className="withmd-fill withmd-doc-scroll">
      <ReadRenderer content={readContent} />
    </div>
  );
}
