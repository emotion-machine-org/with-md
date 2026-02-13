import { httpRouter } from 'convex/server';
import { internal } from './_generated/api';
import { httpAction } from './_generated/server';

const http = httpRouter();

function readBearer(request: Request): string | null {
  const raw = request.headers.get('authorization');
  if (!raw) return null;
  const [scheme, token] = raw.split(' ');
  if (!scheme || !token) return null;
  if (scheme.toLowerCase() !== 'bearer') return null;
  return token;
}

function validateInternalSecret(request: Request): string | null {
  const expected = process.env.HOCUSPOCUS_CONVEX_SECRET ?? process.env.CONVEX_HOCUSPOCUS_SECRET;
  if (!expected) return 'Server missing HOCUSPOCUS_CONVEX_SECRET';

  const incoming = readBearer(request);
  if (!incoming || incoming !== expected) return 'Unauthorized';
  return null;
}

http.route({
  path: '/api/collab/authenticate',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const authError = validateInternalSecret(request);
    if (authError) return new Response(authError, { status: authError === 'Unauthorized' ? 401 : 500 });

    const body = (await request.json()) as {
      userToken: string;
      mdFileId: string;
    };

    const result = await ctx.runQuery(internal.collab.authenticate, {
      userToken: body.userToken ?? '',
      mdFileId: body.mdFileId ?? '',
    });

    return Response.json(result);
  }),
});

http.route({
  path: '/api/collab/loadDocument',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const authError = validateInternalSecret(request);
    if (authError) return new Response(authError, { status: authError === 'Unauthorized' ? 401 : 500 });

    const body = (await request.json()) as {
      mdFileId: string;
    };

    const result = await ctx.runQuery(internal.collab.loadDocument, {
      mdFileId: body.mdFileId as never,
    });

    return Response.json(result);
  }),
});

http.route({
  path: '/api/collab/storeDocument',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const authError = validateInternalSecret(request);
    if (authError) return new Response(authError, { status: authError === 'Unauthorized' ? 401 : 500 });

    const body = (await request.json()) as {
      mdFileId: string;
      markdownContent: string;
      yjsState: string;
    };

    await ctx.runMutation(internal.collab.storeDocument, {
      mdFileId: body.mdFileId as never,
      markdownContent: body.markdownContent ?? '',
      yjsState: body.yjsState ?? '',
    });

    return Response.json({ ok: true });
  }),
});

http.route({
  path: '/api/collab/onAllDisconnected',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const authError = validateInternalSecret(request);
    if (authError) return new Response(authError, { status: authError === 'Unauthorized' ? 401 : 500 });

    const body = (await request.json()) as {
      mdFileId: string;
      markdownContent: string;
      yjsState: string;
    };

    await ctx.runMutation(internal.collab.onAllDisconnected, {
      mdFileId: body.mdFileId as never,
      markdownContent: body.markdownContent ?? '',
      yjsState: body.yjsState ?? '',
    });

    return Response.json({ ok: true });
  }),
});

export default http;
