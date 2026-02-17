import { createPrivateKey } from 'node:crypto';

import { SignJWT, importPKCS8 } from 'jose';

const GITHUB_API = 'https://api.github.com';

// ---------- App JWT ----------

let cachedKey: CryptoKey | null = null;

async function getSigningKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const raw = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!raw) throw new Error('Missing GITHUB_APP_PRIVATE_KEY');

  // GitHub generates PKCS#1 keys ("BEGIN RSA PRIVATE KEY").
  // jose's importPKCS8 requires PKCS#8 ("BEGIN PRIVATE KEY").
  // Use Node's crypto to normalize to PKCS#8 PEM regardless of input format.
  const nodeKey = createPrivateKey(raw);
  const pkcs8Pem = nodeKey.export({ type: 'pkcs8', format: 'pem' }) as string;

  cachedKey = await importPKCS8(pkcs8Pem, 'RS256');
  return cachedKey;
}

export async function createAppJwt(): Promise<string> {
  const appId = process.env.GITHUB_APP_ID;
  if (!appId) throw new Error('Missing GITHUB_APP_ID');

  const key = await getSigningKey();
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(appId)
    .setIssuedAt(now - 60)
    .setExpirationTime(now + 10 * 60)
    .sign(key);
}

// ---------- Installation Token (cached) ----------

interface TokenEntry {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<number, TokenEntry>();

export async function getInstallationToken(installationId: number): Promise<string> {
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const jwt = await createAppJwt();
  const res = await fetch(`${GITHUB_API}/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to get installation token: ${res.status} ${body}`);
  }

  const data = (await res.json()) as { token: string; expires_at: string };
  const expiresAt = new Date(data.expires_at).getTime();
  tokenCache.set(installationId, { token: data.token, expiresAt });
  return data.token;
}

// ---------- User-level API calls ----------

interface Installation {
  id: number;
  account: { login: string; type: string };
}

export async function listUserInstallations(
  userToken: string,
): Promise<{ installationId: number; accountLogin: string; accountType: string }[]> {
  const res = await fetch(`${GITHUB_API}/user/installations`, {
    headers: {
      Authorization: `Bearer ${userToken}`,
      Accept: 'application/vnd.github+json',
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to list installations: ${res.status} ${body}`);
  }

  const data = (await res.json()) as { installations: Installation[] };
  return data.installations.map((i) => ({
    installationId: i.id,
    accountLogin: i.account.login,
    accountType: i.account.type,
  }));
}

interface GhRepo {
  id: number;
  full_name: string;
  owner: { login: string };
  name: string;
  default_branch: string;
  private: boolean;
}

export interface RepoInfo {
  installationId: number;
  githubRepoId: number;
  fullName: string;
  owner: string;
  name: string;
  defaultBranch: string;
  isPrivate: boolean;
}

export async function listInstallationRepos(installationId: number): Promise<RepoInfo[]> {
  const token = await getInstallationToken(installationId);
  const repos: RepoInfo[] = [];
  let page = 1;

  while (true) {
    const res = await fetch(
      `${GITHUB_API}/installation/repositories?per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
      },
    );

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to list repos: ${res.status} ${body}`);
    }

    const data = (await res.json()) as { repositories: GhRepo[]; total_count: number };
    for (const r of data.repositories) {
      repos.push({
        installationId,
        githubRepoId: r.id,
        fullName: r.full_name,
        owner: r.owner.login,
        name: r.name,
        defaultBranch: r.default_branch,
        isPrivate: r.private,
      });
    }

    if (repos.length >= data.total_count) break;
    page++;
  }

  return repos;
}

// ---------- Branch listing ----------

export interface BranchInfo {
  name: string;
  isDefault: boolean;
}

interface GhBranch {
  name: string;
}

export async function listBranches(
  installationId: number,
  owner: string,
  repo: string,
  defaultBranch: string,
): Promise<BranchInfo[]> {
  const token = await getInstallationToken(installationId);
  const branches: BranchInfo[] = [];
  let page = 1;

  while (true) {
    const res = await fetch(
      `${GITHUB_API}/repos/${owner}/${repo}/branches?per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
      },
    );

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to list branches: ${res.status} ${body}`);
    }

    const data = (await res.json()) as GhBranch[];
    for (const b of data) {
      branches.push({
        name: b.name,
        isDefault: b.name === defaultBranch,
      });
    }

    if (data.length < 100) break;
    page++;
  }

  // Sort: default first, then alphabetical
  branches.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return branches;
}

// ---------- Tree / Blob helpers ----------

interface TreeEntry {
  path: string;
  mode: string;
  type: string;
  sha: string;
  size?: number;
}

export interface MdTreeResult {
  commitSha: string;
  treeSha: string;
  files: { path: string; sha: string; size: number }[];
}

export async function fetchMdTree(
  installationId: number,
  owner: string,
  repo: string,
  branch: string,
): Promise<MdTreeResult> {
  const token = await getInstallationToken(installationId);

  // Get the branch HEAD
  const refRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/ref/heads/${branch}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
    },
  });
  if (!refRes.ok) throw new Error(`Failed to get ref: ${refRes.status}`);
  const refData = (await refRes.json()) as { object: { sha: string } };
  const commitSha = refData.object.sha;

  // Get the commit to find its tree
  const commitRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/commits/${commitSha}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
    },
  });
  if (!commitRes.ok) throw new Error(`Failed to get commit: ${commitRes.status}`);
  const commitData = (await commitRes.json()) as { tree: { sha: string } };
  const treeSha = commitData.tree.sha;

  // Get recursive tree
  const treeRes = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
      },
    },
  );
  if (!treeRes.ok) throw new Error(`Failed to get tree: ${treeRes.status}`);
  const treeData = (await treeRes.json()) as { tree: TreeEntry[] };

  const mdFiles = treeData.tree
    .filter((e) => e.type === 'blob' && e.path.endsWith('.md'))
    .map((e) => ({ path: e.path, sha: e.sha, size: e.size ?? 0 }));

  return { commitSha, treeSha, files: mdFiles };
}

export async function fetchBlobContent(
  installationId: number,
  owner: string,
  repo: string,
  sha: string,
): Promise<string> {
  const token = await getInstallationToken(installationId);
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/blobs/${sha}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
    },
  });

  if (!res.ok) throw new Error(`Failed to fetch blob: ${res.status}`);
  const data = (await res.json()) as { content: string; encoding: string };

  if (data.encoding === 'base64') {
    return Buffer.from(data.content, 'base64').toString('utf-8');
  }
  return data.content;
}

// ---------- Commit creation ----------

interface FileChange {
  path: string;
  content: string;
}

export async function createCommitWithFiles(
  installationId: number,
  owner: string,
  repo: string,
  branch: string,
  parentCommitSha: string,
  baseTreeSha: string,
  files: FileChange[],
  message: string,
): Promise<{ commitSha: string }> {
  const token = await getInstallationToken(installationId);
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };

  // Create blobs for each file
  const treeItems: { path: string; mode: string; type: string; sha: string }[] = [];
  for (const file of files) {
    const blobRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/blobs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ content: file.content, encoding: 'utf-8' }),
    });
    if (!blobRes.ok) throw new Error(`Failed to create blob for ${file.path}: ${blobRes.status}`);
    const blobData = (await blobRes.json()) as { sha: string };
    treeItems.push({ path: file.path, mode: '100644', type: 'blob', sha: blobData.sha });
  }

  // Create tree
  const treeRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems }),
  });
  if (!treeRes.ok) throw new Error(`Failed to create tree: ${treeRes.status}`);
  const treeData = (await treeRes.json()) as { sha: string };

  // Create commit
  const commitRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message,
      tree: treeData.sha,
      parents: [parentCommitSha],
    }),
  });
  if (!commitRes.ok) throw new Error(`Failed to create commit: ${commitRes.status}`);
  const commitData = (await commitRes.json()) as { sha: string };

  // Update ref
  const refRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ sha: commitData.sha }),
  });
  if (!refRes.ok) throw new Error(`Failed to update ref: ${refRes.status}`);

  return { commitSha: commitData.sha };
}
