'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import type { MdFile } from '@/lib/with-md/types';

interface Props {
  repoId: string;
  files: MdFile[];
  activePath: string;
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
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

export default function FileTree({ repoId, files, activePath }: Props) {
  const tree = useMemo(() => buildTree(files), [files]);
  const defaultExpanded = useMemo(() => collectExpandedDefaults(tree), [tree]);
  const [expanded, setExpanded] = useState<Set<string>>(defaultExpanded);

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

  function renderNode(node: TreeNode, depth: number) {
    if (node.isDirectory) {
      const isOpen = expanded.has(node.path);
      return (
        <div key={node.key}>
          <button
            type="button"
            className="withmd-filetree-row withmd-filetree-dir"
            style={{ paddingLeft: `${10 + depth * 12}px` }}
            onClick={() => toggleDirectory(node.path)}
          >
            <span className="withmd-filetree-caret">{isOpen ? '▾' : '▸'}</span>
            <span className="withmd-filetree-label">{node.name}</span>
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
    return (
      <Link
        key={node.key}
        href={`/with-md/${repoId}/${encodePath(file.path)}`}
        className={active ? 'withmd-filetree-row withmd-filetree-file withmd-filetree-row-active' : 'withmd-filetree-row withmd-filetree-file'}
        style={{ paddingLeft: `${10 + depth * 12}px` }}
      >
        <span className="withmd-filetree-caret withmd-filetree-caret-dot">•</span>
        <span className="withmd-filetree-label">{node.name}</span>
      </Link>
    );
  }

  return (
    <aside className="withmd-drawer-section withmd-column withmd-fill withmd-pad-3">
      <h2 className="withmd-sidebar-title">Files</h2>
      <div className="withmd-scroll withmd-fill withmd-filetree withmd-mt-2">
        {tree.map((node) => renderNode(node, 0))}
      </div>
    </aside>
  );
}
