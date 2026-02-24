import { describe, expect, it } from 'vitest';

import { detectUnsupportedSyntax } from '@/lib/with-md/syntax';

describe('detectUnsupportedSyntax', () => {
  it('accepts regular markdown', () => {
    const result = detectUnsupportedSyntax('# Title\n\nParagraph text.');
    expect(result.supported).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it('accepts markdown with angle-bracket links and ascii arrows', () => {
    const md = `# Plan\n\nSee <https://example.com>.\n\nflow: source -> parser <- output`;
    const result = detectUnsupportedSyntax(md);
    expect(result.supported).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it('accepts code blocks containing jsx-like text', () => {
    const md = `\`\`\`md\n<MyComponent prop={value} />\n\`\`\`\n\nregular text`;
    const result = detectUnsupportedSyntax(md);
    expect(result.supported).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it('accepts gfm tables (handled by tableBlock extension)', () => {
    const md = `| A | B |\n|---|---|\n| 1 | 2 |`;
    const result = detectUnsupportedSyntax(md);
    expect(result.supported).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it('flags mdx/jsx syntax', () => {
    const md = `import X from './x'\n\n<MyComponent answer={42} />`;
    const result = detectUnsupportedSyntax(md);
    expect(result.supported).toBe(false);
    expect(result.reasons).toContain('mdx_or_embedded_jsx');
  });

  it('flags frontmatter and directives', () => {
    const md = `---\ntitle: x\n---\n\n:::warning\ntext\n:::`;
    const result = detectUnsupportedSyntax(md);
    expect(result.supported).toBe(false);
    expect(result.reasons).toContain('frontmatter');
    expect(result.reasons).toContain('directives');
  });
});
