'use client';

import { useCallback, useEffect, useState } from 'react';

import ActivityPanel from '@/components/with-md/activity-panel';
import CommentsSidebar from '@/components/with-md/comments-sidebar';
import DocumentSurface from '@/components/with-md/document-surface';
import DocumentToolbar from '@/components/with-md/document-toolbar';
import FileTree from '@/components/with-md/file-tree';
import { useCommentAnchors } from '@/hooks/with-md/use-comment-anchors';
import { useDocMode } from '@/hooks/with-md/use-doc-mode';
import { getWithMdApi } from '@/lib/with-md/api';
import { hasMeaningfulDiff } from '@/lib/with-md/markdown-diff';
import type { ActivityItem, CommentRecord, MdFile, RepoSummary } from '@/lib/with-md/types';

interface Props {
  repoId?: string;
  filePath?: string;
}

const api = getWithMdApi();

export default function WithMdShell({ repoId, filePath }: Props) {
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [files, setFiles] = useState<MdFile[]>([]);
  const [currentFile, setCurrentFile] = useState<MdFile | null>(null);
  const [filesOpen, setFilesOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [sourceValue, setSourceValue] = useState('');
  const [isSavingSource, setIsSavingSource] = useState(false);
  const [comments, setComments] = useState<CommentRecord[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const activeRepoId = repoId ?? repos[0]?.repoId ?? '';

  useEffect(() => {
    async function bootstrap() {
      const loadedRepos = await api.listRepos();
      setRepos(loadedRepos);

      const nextRepoId = repoId ?? loadedRepos[0]?.repoId;
      if (!nextRepoId) return;

      const loadedFiles = await api.listFilesByRepo(nextRepoId);
      setFiles(loadedFiles);

      let targetFile: MdFile | null = null;
      if (filePath) {
        targetFile = await api.resolveByPath(nextRepoId, filePath);
      }
      if (!targetFile) {
        targetFile = loadedFiles[0] ?? null;
      }
      setCurrentFile(targetFile);

      if (targetFile) {
        setSourceValue(targetFile.content);
        const [loadedComments, loadedActivity] = await Promise.all([
          api.listCommentsByFile(targetFile.mdFileId),
          api.listActivity(nextRepoId),
        ]);
        setComments(loadedComments);
        setActivity(loadedActivity);
      }
    }

    void bootstrap();
  }, [filePath, repoId]);

  useEffect(() => {
    if (!currentFile) return;
    setSourceValue(currentFile.content);
  }, [currentFile]);

  const syntaxSupported = currentFile?.syntaxSupportStatus !== 'unsupported';
  const { mode, setMode, canUseEditMode } = useDocMode(syntaxSupported, 'read');
  const sourceDirty = Boolean(currentFile && hasMeaningfulDiff(sourceValue, currentFile.content));

  const anchorMap = useCommentAnchors(currentFile?.content ?? '', comments);

  const reloadActivity = useCallback(async () => {
    if (!activeRepoId) return;
    const loaded = await api.listActivity(activeRepoId);
    setActivity(loaded);
  }, [activeRepoId]);

  const reloadCurrentFileData = useCallback(async () => {
    if (!currentFile) return;

    const [freshFile, freshComments] = await Promise.all([
      api.getFile(currentFile.mdFileId),
      api.listCommentsByFile(currentFile.mdFileId),
    ]);

    if (freshFile) {
      setCurrentFile(freshFile);
    }
    setComments(freshComments);
  }, [currentFile]);

  const onSaveSource = useCallback(async () => {
    if (!currentFile) return;
    setIsSavingSource(true);
    setStatusMessage(null);

    try {
      const result = await api.saveSource({
        mdFileId: currentFile.mdFileId,
        sourceContent: sourceValue,
      });
      await reloadCurrentFileData();
      await reloadActivity();

      setStatusMessage(result.changed ? 'Source saved.' : 'No meaningful changes to save.');
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to save source.');
    } finally {
      setIsSavingSource(false);
    }
  }, [currentFile, reloadActivity, reloadCurrentFileData, sourceValue]);

  const onApplySource = useCallback(() => {
    if (!currentFile) return;

    setCurrentFile({
      ...currentFile,
      content: sourceValue,
      contentHash: `applied_${Date.now()}`,
    });
    setStatusMessage('Source applied to local document. Save to persist.');
    if (canUseEditMode) {
      setMode('edit');
    }
  }, [canUseEditMode, currentFile, setMode, sourceValue]);

  const onDiscardSource = useCallback(() => {
    if (!currentFile) return;
    setSourceValue(currentFile.content);
    setStatusMessage('Source changes discarded.');
  }, [currentFile]);

  const onCreateComment = useCallback(
    async (input: { body: string; textQuote: string; fallbackLine: number }) => {
      if (!currentFile) return;

      await api.createComment({
        mdFileId: currentFile.mdFileId,
        authorId: 'local-user',
        body: input.body,
        textQuote: input.textQuote,
        fallbackLine: input.fallbackLine,
      });

      await reloadCurrentFileData();
      await reloadActivity();
    },
    [currentFile, reloadActivity, reloadCurrentFileData],
  );

  const onPush = useCallback(async () => {
    if (!activeRepoId) return;
    await api.pushNow(activeRepoId);
    setStatusMessage('Push triggered.');
    await reloadActivity();
  }, [activeRepoId, reloadActivity]);

  const onResync = useCallback(async () => {
    if (!activeRepoId) return;
    await api.resync(activeRepoId);
    setStatusMessage('Re-sync complete.');
    await reloadActivity();
  }, [activeRepoId, reloadActivity]);

  const onToggleFiles = useCallback(() => {
    setFilesOpen((prev) => {
      const next = !prev;
      if (next) setCommentsOpen(false);
      return next;
    });
  }, []);

  const onToggleComments = useCallback(() => {
    setCommentsOpen((prev) => {
      const next = !prev;
      if (next) setFilesOpen(false);
      return next;
    });
  }, []);

  if (!currentFile) {
    return (
      <main className="withmd-bg withmd-page withmd-page-pad-6">
        <div className="withmd-panel withmd-empty-panel">
          <h1 className="withmd-title">with.md</h1>
          <p className="withmd-muted-sm withmd-mt-3">No markdown files available.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="withmd-bg withmd-page withmd-stage">
      <div className={`withmd-stage-layout ${filesOpen ? 'files-open' : ''} ${commentsOpen ? 'comments-open' : ''}`}>
        <aside className={`withmd-side withmd-side-left ${filesOpen ? 'is-open' : ''}`}>
          <div className="withmd-drawer withmd-drawer-left">
            <div className="withmd-drawer-inner">
              <FileTree repoId={activeRepoId} files={files} activePath={currentFile.path} />
            </div>
          </div>
          <button
            type="button"
            className={`withmd-side-toggle withmd-side-toggle-left ${filesOpen ? 'is-open' : ''}`}
            onClick={onToggleFiles}
          >
            {filesOpen ? 'Close Files' : 'Files'}
          </button>
        </aside>

        <section className="withmd-center">
          <section className="withmd-doc-shell">
            <DocumentToolbar
              mode={mode}
              canUseEditMode={canUseEditMode}
              syntaxReasons={currentFile.syntaxSupportReasons ?? []}
              statusMessage={statusMessage}
              collabActive={mode === 'edit'}
              onModeChange={setMode}
              onPush={onPush}
              onResync={onResync}
            />

            <div className="withmd-doc-stage">
              <div className="withmd-panel withmd-doc-panel withmd-column withmd-fill">
                <DocumentSurface
                  mdFileId={currentFile.mdFileId}
                  mode={mode}
                  readContent={currentFile.content}
                  sourceValue={sourceValue}
                  sourceDirty={sourceDirty}
                  sourceSaving={isSavingSource}
                  canApplySource={canUseEditMode}
                  onSourceChange={setSourceValue}
                  onApplySource={onApplySource}
                  onSaveSource={onSaveSource}
                  onDiscardSource={onDiscardSource}
                  onEditorContentChange={(next) => {
                    setCurrentFile((prev) => (prev ? { ...prev, content: next } : prev));
                  }}
                />
              </div>
            </div>
          </section>
        </section>

        <aside className={`withmd-side withmd-side-right ${commentsOpen ? 'is-open' : ''}`}>
          <button
            type="button"
            className={`withmd-side-toggle withmd-side-toggle-right ${commentsOpen ? 'is-open' : ''}`}
            onClick={onToggleComments}
          >
            {commentsOpen ? 'Close Comments' : 'Comments'}
          </button>
          <div className="withmd-drawer withmd-drawer-right">
            <div className="withmd-drawer-inner withmd-column withmd-gap-3">
              <CommentsSidebar comments={comments} anchorByCommentId={anchorMap} onCreate={onCreateComment} />
              <ActivityPanel activity={activity} />
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
