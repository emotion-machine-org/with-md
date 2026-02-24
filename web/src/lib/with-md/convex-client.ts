import { ConvexHttpClient } from 'convex/browser';

import { WITH_MD_CONVEX_FUNCTIONS } from '@/lib/with-md/convex-functions';

let client: ConvexHttpClient | null = null;

function getClient(): ConvexHttpClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error('Missing NEXT_PUBLIC_CONVEX_URL');
  client = new ConvexHttpClient(url);

  const deployKey = process.env.CONVEX_DEPLOY_KEY;
  if (!deployKey) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Missing CONVEX_DEPLOY_KEY — required in production for admin auth');
    }
    console.warn('CONVEX_DEPLOY_KEY not set — internal Convex functions will not be callable');
  } else {
    (client as unknown as { setAdminAuth(token: string): void }).setAdminAuth(deployKey);
  }

  return client;
}

export async function queryConvex<T>(name: string, args: Record<string, unknown>): Promise<T> {
  return (await getClient().query(name as never, args as never)) as T;
}

export async function mutateConvex<T>(name: string, args: Record<string, unknown>): Promise<T> {
  return (await getClient().mutation(name as never, args as never)) as T;
}

export { WITH_MD_CONVEX_FUNCTIONS as F };
