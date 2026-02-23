import { NextRequest, NextResponse } from 'next/server';

import { F, mutateConvex, queryConvex } from '@/lib/with-md/convex-client';
import { getSessionOrNull, type SessionData } from '@/lib/with-md/session';

// Only expose the subset of functions the browser client actually uses.
// Server-side API routes call convex-client.ts directly with admin auth.
const ALLOWED_QUERY_FUNCTIONS: Set<string> = new Set([
  F.queries.reposList,
  F.queries.mdFilesListByRepo,
  F.queries.mdFilesGet,
  F.queries.mdFilesResolveByPath,
  F.queries.commentsListByFile,
  F.queries.activitiesListByRepo,
  F.queries.pushQueueListByRepo,
]);

const ALLOWED_MUTATION_FUNCTIONS: Set<string> = new Set([
  F.mutations.commentsCreate,
  F.mutations.commentsDelete,
  F.mutations.mdFilesSaveSource,
  F.mutations.mdFilesRevertToGithub,
  F.mutations.mdFilesImportLocalBatch,
  F.mutations.mdFilesMovePath,
  F.mutations.mdFilesRenamePath,
  F.mutations.mdFilesDeleteFile,
  F.mutations.mdFilesUndoFileOperation,
  F.mutations.pushQueuePushNow,
  F.mutations.reposResync,
]);

interface RepoDoc {
  _id: string;
  installationId: string;
}

interface InstallationDoc {
  _id: string;
  connectedBy?: string;
}

interface MdFileDoc {
  _id: string;
  repoId: string;
  isDeleted?: boolean;
}

interface CommentDoc {
  _id: string;
  mdFileId: string;
}

function normalizeArgs(value: unknown): Record<string, unknown> | null {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return { ...(value as Record<string, unknown>) };
}

function readStringArg(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function safeQuery<T>(name: string, args: Record<string, unknown>): Promise<T | null> {
  try {
    return await queryConvex<T | null>(name, args);
  } catch {
    return null;
  }
}

async function getOwnedRepo(repoId: string, sessionUserId: string): Promise<RepoDoc | null> {
  const repo = await safeQuery<RepoDoc>(F.queries.reposGet, {
    repoId: repoId as never,
  });
  if (!repo) return null;

  const installation = await safeQuery<InstallationDoc>(F.queries.installationsGet, {
    installationId: repo.installationId as never,
  });
  if (!installation || installation.connectedBy !== sessionUserId) {
    return null;
  }

  return repo;
}

async function getOwnedFile(mdFileId: string, sessionUserId: string): Promise<MdFileDoc | null> {
  const file = await safeQuery<MdFileDoc>(F.queries.mdFilesGet, {
    mdFileId: mdFileId as never,
  });
  if (!file || file.isDeleted) return null;

  const repo = await getOwnedRepo(file.repoId, sessionUserId);
  if (!repo) return null;
  return file;
}

async function getOwnedComment(commentId: string, sessionUserId: string): Promise<CommentDoc | null> {
  const comment = await safeQuery<CommentDoc>(F.queries.commentsGet, {
    commentId: commentId as never,
  });
  if (!comment) return null;

  const file = await getOwnedFile(comment.mdFileId, sessionUserId);
  if (!file) return null;
  return comment;
}

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

function forbidden(): NextResponse {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

async function sanitizeAndAuthorizeArgs(
  fn: string,
  args: Record<string, unknown>,
  session: SessionData,
): Promise<{ args: Record<string, unknown> } | { response: NextResponse }> {
  switch (fn) {
    case F.queries.reposList:
      return {
        args: {
          ...args,
          userId: session.userId,
        },
      };

    case F.queries.mdFilesListByRepo:
    case F.queries.mdFilesResolveByPath:
    case F.queries.activitiesListByRepo:
    case F.queries.pushQueueListByRepo:
    case F.mutations.mdFilesImportLocalBatch:
    case F.mutations.mdFilesMovePath:
    case F.mutations.mdFilesRenamePath:
    case F.mutations.mdFilesUndoFileOperation:
    case F.mutations.pushQueuePushNow:
    case F.mutations.reposResync: {
      const repoId = readStringArg(args, 'repoId');
      if (!repoId) return { response: badRequest('Missing repoId.') };
      const repo = await getOwnedRepo(repoId, session.userId);
      if (!repo) return { response: forbidden() };
      return {
        args: {
          ...args,
          repoId: repo._id,
        },
      };
    }

    case F.queries.mdFilesGet:
    case F.queries.commentsListByFile:
    case F.mutations.mdFilesSaveSource:
    case F.mutations.mdFilesRevertToGithub: {
      const mdFileId = readStringArg(args, 'mdFileId');
      if (!mdFileId) return { response: badRequest('Missing mdFileId.') };
      const file = await getOwnedFile(mdFileId, session.userId);
      if (!file) return { response: forbidden() };
      return {
        args: {
          ...args,
          mdFileId: file._id,
        },
      };
    }

    case F.mutations.mdFilesDeleteFile: {
      const mdFileId = readStringArg(args, 'mdFileId');
      if (!mdFileId) return { response: badRequest('Missing mdFileId.') };
      const file = await getOwnedFile(mdFileId, session.userId);
      if (!file) return { response: forbidden() };

      const repoId = readStringArg(args, 'repoId');
      if (repoId && repoId !== file.repoId) {
        return { response: forbidden() };
      }

      return {
        args: {
          ...args,
          repoId: file.repoId,
          mdFileId: file._id,
        },
      };
    }

    case F.mutations.commentsCreate: {
      const mdFileId = readStringArg(args, 'mdFileId');
      if (!mdFileId) return { response: badRequest('Missing mdFileId.') };
      const file = await getOwnedFile(mdFileId, session.userId);
      if (!file) return { response: forbidden() };

      const nextArgs: Record<string, unknown> = {
        ...args,
        mdFileId: file._id,
        authorId: session.githubLogin,
      };

      if (args.parentCommentId !== undefined && args.parentCommentId !== null) {
        const parentCommentId = readStringArg(args, 'parentCommentId');
        if (!parentCommentId) return { response: badRequest('Invalid parentCommentId.') };
        const parent = await getOwnedComment(parentCommentId, session.userId);
        if (!parent || parent.mdFileId !== file._id) {
          return { response: forbidden() };
        }
        nextArgs.parentCommentId = parent._id;
      } else {
        delete nextArgs.parentCommentId;
      }

      return { args: nextArgs };
    }

    case F.mutations.commentsDelete: {
      const commentId = readStringArg(args, 'commentId');
      if (!commentId) return { response: badRequest('Missing commentId.') };

      // Idempotent delete: if another client already removed this comment,
      // treat this request as successful no-op.
      const comment = await safeQuery<CommentDoc>(F.queries.commentsGet, {
        commentId: commentId as never,
      });
      if (!comment) {
        return { response: NextResponse.json({ ok: true, result: null }) };
      }

      const file = await getOwnedFile(comment.mdFileId, session.userId);
      if (!file) return { response: forbidden() };

      return {
        args: {
          ...args,
          commentId: comment._id,
        },
      };
    }

    default:
      return { response: forbidden() };
  }
}

export async function POST(request: NextRequest) {
  const session = await getSessionOrNull();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    fn?: string;
    args?: unknown;
    type?: 'query' | 'mutation';
  } | null;

  if (!body || typeof body.fn !== 'string' || (body.type !== 'query' && body.type !== 'mutation')) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const isAllowed = body.type === 'query'
    ? ALLOWED_QUERY_FUNCTIONS.has(body.fn)
    : ALLOWED_MUTATION_FUNCTIONS.has(body.fn);
  if (!isAllowed) {
    return NextResponse.json({ error: 'Function not allowed' }, { status: 403 });
  }

  const args = normalizeArgs(body.args);
  if (!args) {
    return badRequest('Invalid request body');
  }

  const authorized = await sanitizeAndAuthorizeArgs(body.fn, args, session);
  if ('response' in authorized) {
    return authorized.response;
  }

  try {
    let result: unknown;
    if (body.type === 'query') {
      result = await queryConvex(body.fn, authorized.args);
    } else {
      result = await mutateConvex(body.fn, authorized.args);
    }

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error('[rpc]', body.fn, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
