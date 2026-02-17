/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as activities from "../activities.js";
import type * as anonShares from "../anonShares.js";
import type * as collab from "../collab.js";
import type * as comments from "../comments.js";
import type * as http from "../http.js";
import type * as installations from "../installations.js";
import type * as lib_collabPolicy from "../lib/collabPolicy.js";
import type * as lib_markdownDiff from "../lib/markdownDiff.js";
import type * as lib_syntax from "../lib/syntax.js";
import type * as mdFiles from "../mdFiles.js";
import type * as pushQueue from "../pushQueue.js";
import type * as repoShares from "../repoShares.js";
import type * as repos from "../repos.js";
import type * as seed_fallbackFiles from "../seed/fallbackFiles.js";
import type * as suggestions from "../suggestions.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activities: typeof activities;
  anonShares: typeof anonShares;
  collab: typeof collab;
  comments: typeof comments;
  http: typeof http;
  installations: typeof installations;
  "lib/collabPolicy": typeof lib_collabPolicy;
  "lib/markdownDiff": typeof lib_markdownDiff;
  "lib/syntax": typeof lib_syntax;
  mdFiles: typeof mdFiles;
  pushQueue: typeof pushQueue;
  repoShares: typeof repoShares;
  repos: typeof repos;
  "seed/fallbackFiles": typeof seed_fallbackFiles;
  suggestions: typeof suggestions;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
