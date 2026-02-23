"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectGitHubRepo = detectGitHubRepo;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
/**
 * Parse owner/repo from a GitHub remote URL.
 * Handles HTTPS, SSH, and git@ formats.
 */
function parseGitHubRemote(url) {
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
    }
    catch {
        // Not a valid URL
    }
    return null;
}
/**
 * Detect if a file is in a Git repo with a GitHub remote.
 * Returns owner/repo/path info or null if not in a GitHub repo.
 */
function detectGitHubRepo(fileUri) {
    const gitExtension = vscode.extensions.getExtension('vscode.git');
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
//# sourceMappingURL=git-utils.js.map