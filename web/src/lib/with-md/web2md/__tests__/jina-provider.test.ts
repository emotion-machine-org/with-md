import { describe, expect, it } from 'vitest';

import { sanitizeJinaMarkdown } from '@/lib/with-md/web2md/providers/jina';

describe('sanitizeJinaMarkdown', () => {
  it('removes reader wrapper lines and keeps markdown body', () => {
    const raw = [
      'URL Source: https://example.com/post',
      '',
      'Warning: This page maybe not yet fully loaded.',
      '',
      'Markdown Content: # Title',
      '',
      'Paragraph one.',
      '',
      '- Item one',
      '- Item two',
    ].join('\n');

    const result = sanitizeJinaMarkdown(raw);
    expect(result.warnings.length).toBe(1);
    expect(result.markdown).toContain('# Title');
    expect(result.markdown).toContain('Paragraph one.');
    expect(result.markdown).not.toContain('URL Source:');
    expect(result.markdown).not.toContain('Markdown Content:');
  });

  it('returns empty markdown for empty input', () => {
    const result = sanitizeJinaMarkdown('   \n\n ');
    expect(result.markdown).toBe('');
    expect(result.warnings).toEqual([]);
  });
});
