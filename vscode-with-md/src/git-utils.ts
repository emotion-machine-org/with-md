import * as vscode from 'vscode';
import * as path from 'path';

interface GitRepo {
  rootUri: vscode.Uri;
  state: {
    remotes: Array<{
      name: string;
      fetchUrl?: string;
      pushUrl?: string;
    }>;
  };
}

interface GitExtensionApi {
  repositories: GitRepo[];
}

export interface RepoInfo {
  owner: string;
  repo: string;
  /** File path relative to repository root, using forward slashes */
  path: string;
}

/**
 * Parse owner/repo from a GitHub remote URL.
 * Handles HTTPS, SSH, and git@ formats.
 */
function parseGitHubRemote(url: string): { owner: string; repo: string } | null {
  // SSH: git@github.com:owner/repo.git
  const sshMatch = url.match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/i);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  // HTTPS: https://github.com/owner/repo.git
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.toLowerCase().includes('github.com')) {
      return null;
    }
    const segments = parsed.pathname.replace(/^\//, '').replace(/\.git$/, '').split('/');
    if (segments.length >= 2) {
      return { owner: segments[0], repo: segments[1] };
    }
  } catch {
    // Not a valid URL
  }

  return null;
}

/**
 * Detect if a file is in a Git repo with a GitHub remote.
 * Returns owner/repo/path info or null if not in a GitHub repo.
 */
export function detectGitHubRepo(fileUri: vscode.Uri): RepoInfo | null {
  const gitExtension = vscode.extensions.getExtension<{ getAPI(version: number): GitExtensionApi }>('vscode.git');
  if (!gitExtension?.isActive) {
    return null;
  }

  const git = gitExtension.exports.getAPI(1);
  if (!git.repositories.length) {
    return null;
  }

  // Find the repository that contains this file
  const filePath = fileUri.fsPath;
  const repo = git.repositories.find(r => filePath.startsWith(r.rootUri.fsPath));
  if (!repo) {
    return null;
  }

  // Find a GitHub remote — prefer "origin", fallback to first github.com remote
  const remotes = repo.state.remotes;
  const originRemote = remotes.find(r => r.name === 'origin');
  const githubRemote = originRemote ?? remotes.find(r => {
    const url = r.fetchUrl ?? r.pushUrl ?? '';
    return url.toLowerCase().includes('github.com');
  });

  if (!githubRemote) {
    return null;
  }

  const remoteUrl = githubRemote.fetchUrl ?? githubRemote.pushUrl ?? '';
  const parsed = parseGitHubRemote(remoteUrl);
  if (!parsed) {
    return null;
  }

  // Compute relative path from repo root
  const relativePath = path.relative(repo.rootUri.fsPath, filePath).split(path.sep).join('/');

  return {
    owner: parsed.owner,
    repo: parsed.repo,
    path: relativePath,
  };
}
