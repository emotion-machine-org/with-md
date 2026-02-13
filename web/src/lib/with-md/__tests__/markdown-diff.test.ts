import { describe, expect, it } from 'vitest';

import { hasMeaningfulDiff } from '@/lib/with-md/markdown-diff';

describe('hasMeaningfulDiff', () => {
  it('ignores whitespace-only normalization', () => {
    const prev = '# Title\ntext  \n';
    const next = '# Title\ntext\n';
    expect(hasMeaningfulDiff(next, prev)).toBe(false);
  });

  it('detects content changes', () => {
    const prev = '# Title\nhello';
    const next = '# Title\nhello world';
    expect(hasMeaningfulDiff(next, prev)).toBe(true);
  });
});
