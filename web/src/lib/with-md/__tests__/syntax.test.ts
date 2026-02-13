import { describe, expect, it } from 'vitest';

import { detectUnsupportedSyntax } from '@/lib/with-md/syntax';

describe('detectUnsupportedSyntax', () => {
  it('accepts regular markdown', () => {
    const result = detectUnsupportedSyntax('# Title\n\nParagraph text.');
    expect(result.supported).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it('flags frontmatter and directives', () => {
    const md = `---\ntitle: x\n---\n\n:::warning\ntext\n:::`;
    const result = detectUnsupportedSyntax(md);
    expect(result.supported).toBe(false);
    expect(result.reasons).toContain('frontmatter');
    expect(result.reasons).toContain('directives');
  });
});
