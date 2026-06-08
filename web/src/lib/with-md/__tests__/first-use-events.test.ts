import { describe, expect, it } from 'vitest';

import {
  FIRST_USE_ENTRY_SOURCES,
  FIRST_USE_EVENTS,
  normalizeFirstUseEntrySource,
  sanitizeFirstUseProperties,
} from '../first-use-events';

describe('first-use analytics events', () => {
  it('keeps the named first-use events stable', () => {
    expect(FIRST_USE_EVENTS).toEqual({
      shareCreated: 'withmd_first_use_share_created',
      editLinkOpened: 'withmd_first_use_edit_link_opened',
      saveCompleted: 'withmd_first_use_save_completed',
      githubConnected: 'withmd_first_use_github_connected',
      repoSynced: 'withmd_first_use_repo_synced',
      pushBackCompleted: 'withmd_first_use_push_back_completed',
    });
  });

  it('removes private document and credential fields from payload properties', () => {
    expect(sanitizeFirstUseProperties({
      flow: 'anonymous_share',
      content: '# private',
      markdownContent: '# private',
      sourceContent: '# private',
      editSecret: 'secret',
      githubToken: 'token',
      body: 'private',
      size_bytes: 123,
      changed: true,
      missing: undefined,
      nullish: null,
    })).toEqual({
      flow: 'anonymous_share',
      size_bytes: 123,
      changed: true,
      nullish: null,
    });
  });

  it('keeps the named first-use entry sources stable', () => {
    expect(FIRST_USE_ENTRY_SOURCES).toEqual({
      homepageDemo: 'homepage_demo',
      homepageUpload: 'homepage_upload',
      homepageBlank: 'homepage_blank',
      sharedPageCreateOwn: 'shared_page_create_own',
    });
  });

  it('normalizes only the approved first-use entry source labels', () => {
    expect(normalizeFirstUseEntrySource('homepage_demo')).toBe('homepage_demo');
    expect(normalizeFirstUseEntrySource('homepage_upload')).toBe('homepage_upload');
    expect(normalizeFirstUseEntrySource('homepage_blank')).toBe('homepage_blank');
    expect(normalizeFirstUseEntrySource('shared_page_create_own')).toBe('shared_page_create_own');
    expect(normalizeFirstUseEntrySource('public_api')).toBeNull();
    expect(normalizeFirstUseEntrySource(' homepage_upload ')).toBe('homepage_upload');
  });
});
