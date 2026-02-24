import { listInstallationRepos, listUserInstallations } from '@/lib/with-md/github';

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export async function canAccessInstallation(
  userToken: string,
  installationId: number,
): Promise<boolean> {
  const installations = await listUserInstallations(userToken);
  if (!Array.isArray(installations)) return false;
  return installations.some((installation) => installation.installationId === installationId);
}

export async function canAccessRepoInInstallation(
  userToken: string,
  installationId: number,
  owner: string,
  repo: string,
): Promise<boolean> {
  const repos = await listInstallationRepos(installationId, userToken);
  if (!Array.isArray(repos)) return false;
  const expectedOwner = normalize(owner);
  const expectedRepo = normalize(repo);
  return repos.some(
    (entry) => normalize(entry.owner) === expectedOwner && normalize(entry.name) === expectedRepo,
  );
}
