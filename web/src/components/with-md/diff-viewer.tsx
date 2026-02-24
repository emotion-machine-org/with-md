'use client';

import { useEffect, useRef, useState } from 'react';
import { MultiFileDiff } from '@pierre/diffs/react';

import { handleGitHubResponse } from '@/lib/with-md/github-fetch';

interface Props {
  fileName: string;
  mdFileId: string;
  currentContent: string;
  onError(message: string): void;
  onClose(): void;
}

interface CachedBlob {
  mdFileId: string;
  content: string;
}

function getTheme(): string {
  if (typeof document === 'undefined') return 'pierre-dark';
  return document.documentElement.getAttribute('data-theme') === 'light'
    ? 'pierre-light'
    : 'pierre-dark';
}

export default function DiffViewer({ fileName, mdFileId, currentContent, onError, onClose }: Props) {
  const [originalContent, setOriginalContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const cacheRef = useRef<CachedBlob | null>(null);
  const onErrorRef = useRef(onError);
  const onCloseRef = useRef(onClose);
  onErrorRef.current = onError;
  onCloseRef.current = onClose;
  const [theme, setTheme] = useState(getTheme);

  // Watch for theme changes
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setTheme(getTheme());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (cacheRef.current?.mdFileId === mdFileId) {
      setOriginalContent(cacheRef.current.content);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);

    (async () => {
      try {
        const res = await fetch('/api/github/blob', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mdFileId }),
        });

        if (!active) return;
        handleGitHubResponse(res);
        if (!res.ok) {
          const data = (await res.json()) as { error?: string; code?: string };
          if (data.code === 'NO_GITHUB_VERSION') {
            onErrorRef.current('No GitHub version available for diff.');
          } else {
            onErrorRef.current(data.error ?? 'Failed to fetch original content.');
          }
          onCloseRef.current();
          return;
        }

        const data = (await res.json()) as { content: string; sha: string };
        if (!active) return;

        cacheRef.current = { mdFileId, content: data.content };
        setOriginalContent(data.content);
      } catch (err) {
        if (!active) return;
        onErrorRef.current(err instanceof Error ? err.message : 'Failed to fetch original content.');
        onCloseRef.current();
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => { active = false; };
  }, [mdFileId]);

  if (loading || originalContent === null) {
    return (
      <div className="withmd-diff-loading">
        <span className="withmd-muted-xs">Loading diff...</span>
      </div>
    );
  }

  return (
    <div className="withmd-diff-viewer">
      <MultiFileDiff
        oldFile={{ name: fileName, contents: originalContent }}
        newFile={{ name: fileName, contents: currentContent }}
        options={{ theme, diffStyle: 'split' }}
      />
    </div>
  );
}
