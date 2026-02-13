import { describe, expect, it } from 'vitest';

import { recoverAnchor } from '@/lib/with-md/anchor';

describe('recoverAnchor', () => {
  it('finds unique quote directly', () => {
    const markdown = '# A\n\nHello world\n';
    const result = recoverAnchor(markdown, {
      commentMarkId: 'x',
      textQuote: 'Hello world',
      anchorPrefix: '',
      anchorSuffix: '',
      anchorHeadingPath: ['A'],
      fallbackLine: 3,
    });

    expect(result).not.toBeNull();
    expect(result?.start).toBe(markdown.indexOf('Hello world'));
  });

  it('uses heading path when quote duplicated', () => {
    const markdown = '# One\n\nSame\n\n# Two\n\nSame\n';
    const result = recoverAnchor(markdown, {
      commentMarkId: 'x',
      textQuote: 'Same',
      anchorPrefix: '',
      anchorSuffix: '',
      anchorHeadingPath: ['Two'],
      fallbackLine: 7,
    });

    expect(result).not.toBeNull();
    const second = markdown.lastIndexOf('Same');
    expect(result?.start).toBe(second);
  });
});
