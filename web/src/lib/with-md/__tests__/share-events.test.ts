import { describe, expect, test } from 'vitest';

import {
  fileExtensionForShareEvent,
  sourceChannelFromPath,
  sourcePathFromReferer,
  sourceShareIdFromPath,
} from '@/lib/with-md/share-events';

describe('share event helpers', () => {
  test('classifies markdown file extensions without exposing names', () => {
    expect(fileExtensionForShareEvent('plan.md')).toBe('md');
    expect(fileExtensionForShareEvent('brief.markdown')).toBe('markdown');
    expect(fileExtensionForShareEvent('notes.txt')).toBe('other');
    expect(fileExtensionForShareEvent('')).toBe('none');
  });

  test('groups source paths into share attribution channels', () => {
    expect(sourceChannelFromPath('/')).toBe('product_surface');
    expect(sourceChannelFromPath('/s/abc123')).toBe('recipient_loop');
    expect(sourceChannelFromPath('/skill')).toBe('audience');
    expect(sourceChannelFromPath('/r/team-doc')).toBe('direct');
    expect(sourceChannelFromPath('/workspace')).toBe('other');
  });

  test('reads shared-page source ids from paths and referrers', () => {
    expect(sourceShareIdFromPath('/s/abc123?edit=secret')).toBe('abc123');
    expect(sourcePathFromReferer('https://with.md/s/from-referrer?x=1')).toBe('/s/from-referrer');
    expect(sourcePathFromReferer('not a url')).toBeNull();
  });
});
