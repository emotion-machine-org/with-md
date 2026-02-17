'use client';

import { useEffect, useMemo, useState } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';

import type { MdFile, RepoSummary } from '@/lib/with-md/types';

interface Props {
  repoId: string;
  files: MdFile[];
  activePath: string;
  pendingPaths?: ReadonlySet<string>;
  activeRepo?: RepoSummary;
  currentBranch?: string;
  onOpenRepoPicker?: () => void;
  onOpenBranchSwitcher?: () => void;
  onSelectPath?: (path: string) => void;
  onMovePath?: (input: { fromPath: string; toDirectoryPath: string; isDirectory: boolean }) => Promise<void>;
  onRenamePath?: (input: { fromPath: string; toPath: string; isDirectory: boolean }) => Promise<void>;
}

const DND_MIME = 'application/x-withmd-path';

interface DragPayload {
  path: string;
  isDirectory: boolean;
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={open ? 'withmd-filetree-chevron is-open' : 'withmd-filetree-chevron'}
      viewBox="0 0 12 12"
      aria-hidden="true"
    >
      <path d="M4 2.5L8 6L4 9.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function FolderIcon({ open }: { open: boolean }) {
  return (
    <svg className={open ? 'withmd-filetree-icon is-open' : 'withmd-filetree-icon'} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M1.5 4.5a1 1 0 0 1 1-1h3l1.1 1.2c.2.2.4.3.7.3h6.2a1 1 0 0 1 1 1v6.8a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function fileName(path: string): string {
  const segments = path.split('/');
  return segments[segments.length - 1] ?? path;
}

function parentPath(path: string): string {
  const segments = path.split('/');
  segments.pop();
  return segments.join('/');
}

function joinPath(parent: string, child: string): string {
  const parentNormalized = parent.trim().replace(/^\/+|\/+$/g, '');
  const childNormalized = child.trim().replace(/^\/+|\/+$/g, '');
  if (!parentNormalized) return childNormalized;
  if (!childNormalized) return parentNormalized;
  return `${parentNormalized}/${childNormalized}`;
}

interface TreeNode {
  key: string;
  name: string;
  path: string;
  isDirectory: boolean;
  file?: MdFile;
  children: TreeNode[];
}

function sortTree(nodes: TreeNode[]): TreeNode[] {
  return nodes
    .map((node) => ({
      ...node,
      children: sortTree(node.children),
    }))
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
}

function buildTree(files: MdFile[]): TreeNode[] {
  const rootChildren: TreeNode[] = [];
  const nodeByPath = new Map<string, TreeNode>();

  for (const file of files) {
    const segments = file.path.split('/').filter(Boolean);
    let currentChildren = rootChildren;
    let currentPath = '';

    segments.forEach((segment, index) => {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const isLeaf = index === segments.length - 1;

      let node = nodeByPath.get(currentPath);
      if (!node) {
        node = {
          key: currentPath,
          name: segment,
          path: currentPath,
          isDirectory: !isLeaf,
          file: undefined,
          children: [],
        };
        nodeByPath.set(currentPath, node);
        currentChildren.push(node);
      }

      if (isLeaf) {
        node.isDirectory = false;
        node.file = file;
      }

      currentChildren = node.children;
    });
  }

  return sortTree(rootChildren);
}

function collectExpandedDefaults(nodes: TreeNode[], depth = 0, expanded = new Set<string>()): Set<string> {
  for (const node of nodes) {
    if (!node.isDirectory) continue;
    if (depth < 2) expanded.add(node.path);
    collectExpandedDefaults(node.children, depth + 1, expanded);
  }
  return expanded;
}

function isInternalDrag(event: ReactDragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes(DND_MIME);
}

function readDragPayload(event: ReactDragEvent<HTMLElement>): DragPayload | null {
  const raw = event.dataTransfer.getData(DND_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DragPayload;
    if (!parsed.path || typeof parsed.path !== 'string') return null;
    return {
      path: parsed.path,
      isDirectory: Boolean(parsed.isDirectory),
    };
  } catch {
    return null;
  }
}

function SwitchIcon() {
  return (
    <svg className="withmd-repo-switcher-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M5.22 14.78a.75.75 0 0 0 1.06-1.06L4.56 12h8.69a.75.75 0 0 0 0-1.5H4.56l1.72-1.72a.75.75 0 0 0-1.06-1.06l-3 3a.75.75 0 0 0 0 1.06l3 3ZM10.78 1.22a.75.75 0 0 0-1.06 1.06L11.44 4H2.75a.75.75 0 0 0 0 1.5h8.69l-1.72 1.72a.75.75 0 1 0 1.06 1.06l3-3a.75.75 0 0 0 0-1.06l-3-3Z"
        fill="currentColor"
      />
    </svg>
  );
}

function BranchSmallIcon() {
  return (
    <svg className="withmd-repo-switcher-branch-icon" viewBox="0 0 16 16" aria-hidden="true" width="12" height="12">
      <path
        d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Z"
        fill="currentColor"
      />
    </svg>
  );
}

export default function FileTree({ repoId, files, activePath, pendingPaths, activeRepo, currentBranch, onOpenRepoPicker, onOpenBranchSwitcher, onSelectPath, onMovePath, onRenamePath }: Props) {
  const tree = useMemo(() => buildTree(files), [files]);
  const pendingDirectoryPaths = useMemo(() => {
    const directories = new Set<string>();
    if (!pendingPaths || pendingPaths.size === 0) return directories;

    for (const path of pendingPaths) {
      const segments = path.split('/');
      segments.pop();
      let cursor = '';
      for (const segment of segments) {
        cursor = cursor ? `${cursor}/${segment}` : segment;
        directories.add(cursor);
      }
    }
    return directories;
  }, [pendingPaths]);
  const defaultExpanded = useMemo(() => collectExpandedDefaults(tree), [tree]);
  const [expanded, setExpanded] = useState<Set<string>>(defaultExpanded);
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);

  useEffect(() => {
    setExpanded(defaultExpanded);
  }, [defaultExpanded]);

  function toggleDirectory(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function startRename(node: TreeNode) {
    setRenamingPath(node.path);
    setRenameValue(node.name);
  }

  async function commitRename(node: TreeNode) {
    if (!onRenamePath || !renamingPath) {
      setRenamingPath(null);
      setRenameValue('');
      return;
    }

    const nextName = renameValue.trim();
    if (!nextName || nextName === node.name) {
      setRenamingPath(null);
      setRenameValue('');
      return;
    }

    const nextPath = joinPath(parentPath(node.path), nextName);
    setRenameBusy(true);
    try {
      await onRenamePath({
        fromPath: node.path,
        toPath: nextPath,
        isDirectory: node.isDirectory,
      });
      setRenamingPath(null);
      setRenameValue('');
    } finally {
      setRenameBusy(false);
    }
  }

  async function handleDrop(event: ReactDragEvent<HTMLElement>, toDirectoryPath: string) {
    if (!onMovePath) return;
    const payload = readDragPayload(event);
    if (!payload) return;

    event.preventDefault();
    event.stopPropagation();
    setDropTargetPath(null);

    await onMovePath({
      fromPath: payload.path,
      toDirectoryPath,
      isDirectory: payload.isDirectory,
    });
  }

  function renderNode(node: TreeNode, depth: number) {
    const isRenaming = renamingPath === node.path;

    if (node.isDirectory) {
      const isOpen = expanded.has(node.path);
      const isDropTarget = dropTargetPath === node.path;
      const isDragging = draggingPath === node.path;
      const hasPendingDescendant = pendingDirectoryPaths.has(node.path);
      return (
        <div key={node.key}>
          <button
            type="button"
            className={[
              'withmd-filetree-row',
              'withmd-filetree-dir',
              hasPendingDescendant ? 'withmd-filetree-dir-pending' : '',
              isDropTarget ? 'withmd-filetree-drop-target' : '',
              isDragging ? 'withmd-filetree-row-dragging' : '',
            ].join(' ').trim()}
            style={{ paddingLeft: `${8 + depth * 14}px` }}
            onClick={() => toggleDirectory(node.path)}
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              startRename(node);
            }}
            draggable={!isRenaming}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData(DND_MIME, JSON.stringify({ path: node.path, isDirectory: true }));
              setDraggingPath(node.path);
            }}
            onDragEnd={() => {
              setDraggingPath(null);
              setDropTargetPath(null);
            }}
            onDragOver={(event) => {
              if (!isInternalDrag(event)) return;
              event.preventDefault();
              event.stopPropagation();
              setDropTargetPath(node.path);
            }}
            onDrop={(event) => void handleDrop(event, node.path)}
          >
            <span className="withmd-filetree-caret" aria-hidden="true">
              <ChevronIcon open={isOpen} />
            </span>
            <span className="withmd-filetree-glyph" aria-hidden="true">
              <FolderIcon open={isOpen} />
            </span>
            {isRenaming ? (
              <input
                className="withmd-filetree-rename-input"
                value={renameValue}
                autoFocus
                disabled={renameBusy}
                onChange={(event) => setRenameValue(event.target.value)}
                onBlur={() => void commitRename(node)}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void commitRename(node);
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setRenamingPath(null);
                    setRenameValue('');
                  }
                }}
              />
            ) : (
              <>
                <span className="withmd-filetree-label">{node.name}</span>
                {hasPendingDescendant ? <span className="withmd-filetree-pending-dot withmd-filetree-pending-dot-dir" aria-hidden="true" /> : null}
              </>
            )}
          </button>

          {isOpen && node.children.map((child) => renderNode(child, depth + 1))}
        </div>
      );
    }

    const file = node.file;
    if (!file) {
      return <div key={node.key} />;
    }

    const active = file.path === activePath;
    const isDragging = draggingPath === file.path;
    const isPending = Boolean(pendingPaths?.has(file.path));
    return (
      <button
        key={node.key}
        type="button"
        className={[
          'withmd-filetree-row',
          'withmd-filetree-file',
          isPending ? 'withmd-filetree-file-pending' : '',
          active ? 'withmd-filetree-row-active' : '',
          isDragging ? 'withmd-filetree-row-dragging' : '',
        ].join(' ').trim()}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={() => {
          if (onSelectPath) {
            onSelectPath(file.path);
            return;
          }
          window.location.href = `/with-md/${repoId}/${encodePath(file.path)}`;
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          startRename(node);
        }}
        draggable={!isRenaming}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData(DND_MIME, JSON.stringify({ path: file.path, isDirectory: false }));
          setDraggingPath(file.path);
        }}
        onDragEnd={() => {
          setDraggingPath(null);
          setDropTargetPath(null);
        }}
      >
        <span className="withmd-filetree-caret withmd-filetree-caret-empty" aria-hidden="true" />
        {isRenaming ? (
          <input
            className="withmd-filetree-rename-input"
            value={renameValue}
            autoFocus
            disabled={renameBusy}
            onChange={(event) => setRenameValue(event.target.value)}
            onBlur={() => void commitRename(node)}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void commitRename(node);
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                setRenamingPath(null);
                setRenameValue('');
              }
            }}
          />
        ) : (
          <>
            <span className="withmd-filetree-label">{node.name}</span>
            {isPending ? <span className="withmd-filetree-pending-dot" aria-hidden="true" /> : null}
          </>
        )}
      </button>
    );
  }

  return (
    <aside className="withmd-drawer-section withmd-column withmd-fill withmd-pad-3">
      <h2 className="withmd-sidebar-title">Files</h2>
      <div
        className={[
          'withmd-scroll',
          'withmd-fill',
          'withmd-filetree',
          'withmd-mt-2',
          dropTargetPath === '' ? 'withmd-filetree-drop-target-root' : '',
        ].join(' ').trim()}
        onDragOver={(event) => {
          if (!isInternalDrag(event)) return;
          event.preventDefault();
          setDropTargetPath('');
        }}
        onDragLeave={() => {
          if (dropTargetPath === '') {
            setDropTargetPath(null);
          }
        }}
        onDrop={(event) => void handleDrop(event, '')}
      >
        {tree.map((node) => renderNode(node, 0))}
      </div>
      {activeRepo && (
        <div className="withmd-filetree-footer">
          <button
            type="button"
            className="withmd-repo-switcher-btn"
            onClick={onOpenRepoPicker}
            title="Switch repository"
          >
            <span className="withmd-repo-switcher-meta">Repository</span>
            <span className="withmd-repo-switcher-main">
              <span className="withmd-repo-switcher-label">
                {activeRepo.owner}/{activeRepo.name}
              </span>
              <SwitchIcon />
            </span>
          </button>
          {(currentBranch || activeRepo.defaultBranch) && (
            <button
              type="button"
              className="withmd-repo-switcher-branch"
              onClick={onOpenBranchSwitcher}
              title="Switch branch"
            >
              <BranchSmallIcon />
              <span className="withmd-repo-switcher-branch-name">
                {currentBranch || activeRepo.defaultBranch}
              </span>
              <SwitchIcon />
            </button>
          )}
        </div>
      )}
    </aside>
  );
}
