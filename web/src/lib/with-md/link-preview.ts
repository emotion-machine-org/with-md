import { F, queryConvex } from '@/lib/with-md/convex-client';

export const LINK_PREVIEW_IMAGE_SIZE = {
  width: 1200,
  height: 630,
} as const;

const REPO_SHARE_SHORT_ID_HASH_SCOPE = 'withmd:repo-share:short-id';
const FALLBACK_ANON_TITLE = 'Shared markdown on with.md';
const FALLBACK_ANON_DESCRIPTION = 'Open an anonymous markdown share link on with.md.';
const FALLBACK_REPO_TITLE = 'GitHub-backed markdown collaboration on with.md';
const FALLBACK_REPO_DESCRIPTION = 'Open a private repository share link for GitHub-backed markdown collaboration on with.md.';

interface AnonSharePreviewRecord {
  title: string;
  content: string;
}

interface RepoShareAccessRecord {
  mdFileId: string;
}

interface RepoFilePreviewRecord {
  path: string;
  content: string;
  isDeleted?: boolean;
}

interface BuildPreviewInput {
  content?: string | null;
  fallbackDescription: string;
  fallbackTitle: string;
  label: string;
  preferredTitle?: string | null;
}

export interface LinkPreviewDetails {
  description: string;
  imageAlt: string;
  imagePath: string;
  label: string;
  metaTitle: string;
  title: string;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function clampText(value: string, maxLength: number): string {
  const collapsed = collapseWhitespace(value);
  if (collapsed.length <= maxLength) return collapsed;

  const slice = collapsed.slice(0, maxLength - 3);
  const lastSpace = slice.lastIndexOf(' ');
  const end = lastSpace >= Math.floor(maxLength * 0.55) ? lastSpace : slice.length;
  return `${slice.slice(0, end).trim()}...`;
}

function stripMarkdownLine(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s?/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/^\[[ xX]\]\s+/, '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_~]{1,3}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\|/g, ' ')
    .trim();
}

function normalizeComparisonKey(value: string): string {
  return collapseWhitespace(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hashRepoShareShortIdForPreview(shortId: string): Promise<string> {
  return sha256Hex(`${REPO_SHARE_SHORT_ID_HASH_SCOPE}:${shortId}`);
}

function isGenericTitle(value: string): boolean {
  const key = normalizeComparisonKey(value);
  return key === '' || key === 'shareddocument' || key === 'sharedmarkdown' || key === 'untitled';
}

function removeFrontmatter(markdown: string): string {
  return markdown.replace(/^---\s*[\s\S]*?\n---\s*/, '');
}

function getPreviewLines(markdown: string): string[] {
  const withoutFrontmatter = removeFrontmatter(markdown).replace(/<!--[\s\S]*?-->/g, '');
  const lines: string[] = [];
  let inFence = false;

  for (const line of withoutFrontmatter.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^(```|~~~)/.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !trimmed) continue;
    if (/^[-*_]{3,}$/.test(trimmed)) continue;
    if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(trimmed)) continue;

    const cleaned = collapseWhitespace(stripMarkdownLine(trimmed));
    if (cleaned) lines.push(cleaned);
  }

  return lines;
}

export function titleFromPath(path: string): string {
  const fileName = path.split('/').pop() ?? '';
  const withoutExt = fileName.replace(/\.markdown$/i, '').replace(/\.md$/i, '');
  return withoutExt || 'Shared markdown';
}

export function titleFromMarkdown(markdown: string): string | null {
  for (const line of removeFrontmatter(markdown).split(/\r?\n/)) {
    const match = line.match(/^#\s+(.+)$/);
    if (match?.[1]) {
      return clampText(stripMarkdownLine(match[1]), 90);
    }
  }
  return null;
}

export function buildLinkPreview(input: BuildPreviewInput): LinkPreviewDetails {
  const content = input.content ?? '';
  const markdownTitle = content ? titleFromMarkdown(content) : null;
  const preferredTitle = clampText(input.preferredTitle ?? '', 90);
  const title = isGenericTitle(preferredTitle) ? (markdownTitle ?? input.fallbackTitle) : preferredTitle;
  const titleKey = normalizeComparisonKey(title);
  const excerpt = getPreviewLines(content)
    .filter((line) => normalizeComparisonKey(line) !== titleKey)
    .slice(0, 4)
    .join(' ');
  const description = clampText(excerpt || input.fallbackDescription, 220);
  const metaTitle = title.includes('with.md') ? title : `${title} - with.md`;

  return {
    description,
    imageAlt: `${title} preview on with.md`,
    imagePath: '',
    label: input.label,
    metaTitle,
    title,
  };
}

export async function getAnonShareLinkPreview(shareId: string): Promise<LinkPreviewDetails> {
  const imagePath = `/og/s/${encodeURIComponent(shareId)}`;

  try {
    const share = await queryConvex<AnonSharePreviewRecord | null>(F.queries.anonSharesGetPublic, {
      shortId: shareId.trim(),
    });

    if (share) {
      return {
        ...buildLinkPreview({
          content: share.content,
          fallbackDescription: FALLBACK_ANON_DESCRIPTION,
          fallbackTitle: FALLBACK_ANON_TITLE,
          label: 'anonymous share',
          preferredTitle: share.title,
        }),
        imagePath,
      };
    }
  } catch (error) {
    console.warn('Could not load anonymous share link preview', error);
  }

  return {
    ...buildLinkPreview({
      fallbackDescription: FALLBACK_ANON_DESCRIPTION,
      fallbackTitle: FALLBACK_ANON_TITLE,
      label: 'anonymous share',
    }),
    imagePath,
  };
}

export async function getRepoShareLinkPreview(token: string): Promise<LinkPreviewDetails> {
  const imagePath = `/og/r/${encodeURIComponent(token)}`;

  try {
    const shareAccess = await queryConvex<RepoShareAccessRecord | null>(F.queries.repoSharesResolve, {
      shortIdHash: await hashRepoShareShortIdForPreview(token.trim()),
    });

    if (shareAccess) {
      const file = await queryConvex<RepoFilePreviewRecord | null>(F.queries.mdFilesGet, {
        mdFileId: shareAccess.mdFileId,
      });

      if (file && !file.isDeleted) {
        return {
          ...buildLinkPreview({
            content: file.content,
            fallbackDescription: FALLBACK_REPO_DESCRIPTION,
            fallbackTitle: FALLBACK_REPO_TITLE,
            label: 'repo share',
            preferredTitle: titleFromPath(file.path),
          }),
          imagePath,
        };
      }
    }
  } catch (error) {
    console.warn('Could not load repository share link preview', error);
  }

  return {
    ...buildLinkPreview({
      fallbackDescription: FALLBACK_REPO_DESCRIPTION,
      fallbackTitle: FALLBACK_REPO_TITLE,
      label: 'repo share',
    }),
    imagePath,
  };
}
