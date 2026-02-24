import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Mocks ----

vi.mock('@/lib/with-md/github', () => ({
  listUserInstallations: vi.fn(),
  listInstallationRepos: vi.fn(),
  listBranches: vi.fn(),
  getRepoInstallationId: vi.fn(),
  getInstallationToken: vi.fn(),
}));

vi.mock('@/lib/with-md/session', () => ({
  getSessionOrNull: vi.fn(),
}));

import {
  getRepoInstallationId,
  listBranches,
  listInstallationRepos,
  listUserInstallations,
} from '@/lib/with-md/github';
import { getSessionOrNull } from '@/lib/with-md/session';

const mockListUserInstallations = vi.mocked(listUserInstallations);
const mockListInstallationRepos = vi.mocked(listInstallationRepos);
const mockListBranches = vi.mocked(listBranches);
const mockGetRepoInstallationId = vi.mocked(getRepoInstallationId);
const mockGetSessionOrNull = vi.mocked(getSessionOrNull);

const fakeSession = {
  userId: 'user_1',
  githubUserId: 12345,
  githubLogin: 'testuser',
  githubToken: 'gho_fake',
};

beforeEach(() => {
  vi.resetAllMocks();
  mockGetSessionOrNull.mockResolvedValue(fakeSession);
});

// ---- Branches route tests ----

describe('GET /api/github/branches', () => {
  let GET: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    ({ GET } = await import('@/app/api/github/branches/route'));
    mockListInstallationRepos.mockResolvedValue([
      {
        installationId: 1,
        githubRepoId: 100,
        fullName: 'org/my-repo',
        owner: 'org',
        name: 'my-repo',
        defaultBranch: 'main',
        isPrivate: false,
      },
    ]);
  });

  function makeBranchRequest(params: Record<string, string>) {
    const url = new URL('http://localhost/api/github/branches');
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return new NextRequest(url);
  }

  it('stale installationId → first listBranches fails → resolves fresh → succeeds', async () => {
    const staleId = 111;
    const freshId = 222;
    const branches = [{ name: 'main', isDefault: true }];

    mockListBranches
      .mockRejectedValueOnce(new Error('Failed to list branches: 404'))
      .mockResolvedValueOnce(branches);
    mockGetRepoInstallationId.mockResolvedValueOnce(freshId);

    const res = await GET(
      makeBranchRequest({
        installationId: String(staleId),
        owner: 'org',
        repo: 'my-repo',
        defaultBranch: 'main',
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(branches);

    // First call with stale ID, second with fresh
    expect(mockListBranches).toHaveBeenCalledTimes(2);
    expect(mockListBranches).toHaveBeenNthCalledWith(1, staleId, 'org', 'my-repo', 'main');
    expect(mockListBranches).toHaveBeenNthCalledWith(2, freshId, 'org', 'my-repo', 'main');
    expect(mockGetRepoInstallationId).toHaveBeenCalledWith('org', 'my-repo');
  });

  it('stale installationId → both attempts fail → returns 500', async () => {
    mockListBranches.mockRejectedValue(new Error('Failed to list branches: 404'));
    mockGetRepoInstallationId.mockResolvedValueOnce(333);

    const res = await GET(
      makeBranchRequest({
        installationId: '111',
        owner: 'org',
        repo: 'my-repo',
        defaultBranch: 'main',
      }),
    );

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Failed to list branches');
  });

  it('no installationId → resolves via getRepoInstallationId → returns branches', async () => {
    const freshId = 444;
    const branches = [
      { name: 'main', isDefault: true },
      { name: 'dev', isDefault: false },
    ];

    mockGetRepoInstallationId.mockResolvedValueOnce(freshId);
    mockListBranches.mockResolvedValueOnce(branches);

    const res = await GET(
      makeBranchRequest({
        installationId: '0',
        owner: 'org',
        repo: 'my-repo',
        defaultBranch: 'main',
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(branches);
    expect(mockListBranches).toHaveBeenCalledTimes(1);
    expect(mockListBranches).toHaveBeenCalledWith(freshId, 'org', 'my-repo', 'main');
  });

  it('401 from GitHub → returns 401 with github_token_expired code', async () => {
    mockGetRepoInstallationId.mockRejectedValueOnce(
      new Error('Failed to get installation for org/my-repo: 401 Bad credentials'),
    );

    const res = await GET(
      makeBranchRequest({
        installationId: '0',
        owner: 'org',
        repo: 'my-repo',
        defaultBranch: 'main',
      }),
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe('github_token_expired');
  });
});

// ---- Repos route tests ----

describe('GET /api/github/repos', () => {
  let GET: () => Promise<Response>;

  beforeEach(async () => {
    ({ GET } = await import('@/app/api/github/repos/route'));
  });

  it('valid token → returns repos', async () => {
    const installations = [{ installationId: 1, accountLogin: 'org', accountType: 'Organization' }];
    const repos = [
      {
        installationId: 1,
        githubRepoId: 100,
        fullName: 'org/repo',
        owner: 'org',
        name: 'repo',
        defaultBranch: 'main',
        isPrivate: false,
      },
    ];

    mockListUserInstallations.mockResolvedValueOnce(installations);
    mockListInstallationRepos.mockResolvedValueOnce(repos);

    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(repos);
    // Must pass user token for user-scoped repo filtering
    expect(mockListInstallationRepos).toHaveBeenCalledWith(1, fakeSession.githubToken);
  });

  it('stale token (401 from GitHub) → returns 401 with github_token_expired code', async () => {
    mockListUserInstallations.mockRejectedValueOnce(
      new Error('Failed to list installations: 401 Bad credentials'),
    );

    const res = await GET();

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe('github_token_expired');
    expect(body.error).toBe('GitHub token expired');
  });
});
