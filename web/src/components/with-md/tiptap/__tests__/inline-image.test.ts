import { MarkdownManager } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';

import { InlineImage } from '@/components/with-md/tiptap/inline-image';

function roundTrip(markdown: string) {
  const manager = new MarkdownManager({
    extensions: [StarterKit, InlineImage],
  });
  return manager.serialize(manager.parse(markdown));
}

describe('InlineImage markdown support', () => {
  it('keeps standard image markdown through the rich editor markdown pipeline', () => {
    const markdown = '# Asset\n\n![Revenue chart](https://example.com/chart.png)\n\nDone.';

    expect(roundTrip(markdown)).toBe(markdown);
  });

  it('keeps double-bracket image captions through the rich editor markdown pipeline', () => {
    const markdown = '# Asset\n\n![[Revenue chart]](https://example.com/chart.png)\n\nDone.';

    expect(roundTrip(markdown)).toBe(markdown);
  });
});
