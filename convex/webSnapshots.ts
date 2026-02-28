import type { Id } from './_generated/dataModel';
import { internalMutation, internalQuery } from './_generated/server';
import { v } from 'convex/values';

interface WebSnapshotDoc {
  _id: Id<'webSnapshots'>;
  urlHash: string;
  normalizedUrl: string;
  displayUrl: string;
  title: string;
  markdown: string;
  markdownHash: string;
  sourceEngine: string;
  sourceDetail?: string;
  httpStatus?: number;
  contentType?: string;
  fetchedAt: number;
  staleAt: number;
  version: number;
  tokenEstimate?: number;
  lastError?: string;
}

export const getByUrlHash = internalQuery({
  args: {
    urlHash: v.string(),
  },
  handler: async (ctx, args) => {
    const snapshot = await ctx.db
      .query('webSnapshots')
      .withIndex('by_url_hash', (q) => q.eq('urlHash', args.urlHash))
      .first();

    return snapshot;
  },
});

export const listVersions = internalQuery({
  args: {
    urlHash: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('webSnapshotVersions')
      .withIndex('by_url_hash_and_created_at', (q) => q.eq('urlHash', args.urlHash))
      .collect();

    const sorted = rows.sort((a, b) => b.createdAt - a.createdAt);
    const limit = args.limit && args.limit > 0 ? Math.min(args.limit, 50) : 20;
    return sorted.slice(0, limit);
  },
});

export const upsertSnapshot = internalMutation({
  args: {
    urlHash: v.string(),
    normalizedUrl: v.string(),
    displayUrl: v.string(),
    title: v.string(),
    markdown: v.string(),
    markdownHash: v.string(),
    sourceEngine: v.string(),
    sourceDetail: v.optional(v.string()),
    httpStatus: v.optional(v.number()),
    contentType: v.optional(v.string()),
    fetchedAt: v.number(),
    staleAt: v.number(),
    tokenEstimate: v.optional(v.number()),
    trigger: v.string(),
    metadata: v.optional(v.string()),
    lastError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('webSnapshots')
      .withIndex('by_url_hash', (q) => q.eq('urlHash', args.urlHash))
      .first() as WebSnapshotDoc | null;

    if (!existing) {
      const snapshotId = await ctx.db.insert('webSnapshots', {
        urlHash: args.urlHash,
        normalizedUrl: args.normalizedUrl,
        displayUrl: args.displayUrl,
        title: args.title,
        markdown: args.markdown,
        markdownHash: args.markdownHash,
        sourceEngine: args.sourceEngine,
        sourceDetail: args.sourceDetail,
        httpStatus: args.httpStatus,
        contentType: args.contentType,
        fetchedAt: args.fetchedAt,
        staleAt: args.staleAt,
        version: 1,
        tokenEstimate: args.tokenEstimate,
        lastError: args.lastError,
      });

      await ctx.db.insert('webSnapshotVersions', {
        snapshotId,
        urlHash: args.urlHash,
        version: 1,
        normalizedUrl: args.normalizedUrl,
        markdown: args.markdown,
        markdownHash: args.markdownHash,
        sourceEngine: args.sourceEngine,
        trigger: args.trigger,
        createdAt: args.fetchedAt,
        metadata: args.metadata,
      });

      return {
        snapshotId,
        version: 1,
      };
    }

    const nextVersion = existing.version + 1;
    await ctx.db.patch(existing._id, {
      normalizedUrl: args.normalizedUrl,
      displayUrl: args.displayUrl,
      title: args.title,
      markdown: args.markdown,
      markdownHash: args.markdownHash,
      sourceEngine: args.sourceEngine,
      sourceDetail: args.sourceDetail,
      httpStatus: args.httpStatus,
      contentType: args.contentType,
      fetchedAt: args.fetchedAt,
      staleAt: args.staleAt,
      version: nextVersion,
      tokenEstimate: args.tokenEstimate,
      lastError: args.lastError,
    });

    await ctx.db.insert('webSnapshotVersions', {
      snapshotId: existing._id,
      urlHash: args.urlHash,
      version: nextVersion,
      normalizedUrl: args.normalizedUrl,
      markdown: args.markdown,
      markdownHash: args.markdownHash,
      sourceEngine: args.sourceEngine,
      trigger: args.trigger,
      createdAt: args.fetchedAt,
      metadata: args.metadata,
    });

    return {
      snapshotId: existing._id,
      version: nextVersion,
    };
  },
});
