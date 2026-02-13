import { ConvexHttpClient } from 'convex/browser';

import { WITH_MD_CONVEX_FUNCTIONS } from '@/lib/with-md/convex-functions';

let client: ConvexHttpClient | null = null;

function getClient(): ConvexHttpClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error('Missing NEXT_PUBLIC_CONVEX_URL');
  client = new ConvexHttpClient(url);
  return client;
}

export async function queryConvex<T>(name: string, args: Record<string, unknown>): Promise<T> {
  return (await getClient().query(name as never, args as never)) as T;
}

export async function mutateConvex<T>(name: string, args: Record<string, unknown>): Promise<T> {
  return (await getClient().mutation(name as never, args as never)) as T;
}

export { WITH_MD_CONVEX_FUNCTIONS as F };
