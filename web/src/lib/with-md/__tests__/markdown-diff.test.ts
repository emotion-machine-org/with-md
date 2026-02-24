import { describe, expect, it } from 'vitest';

import { hasMeaningfulDiff, stripTrailingPlaceholders } from '@/lib/with-md/markdown-diff';

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

  it('ignores extra blank lines between blocks', () => {
    const prev = '# Title\n\n\n\nParagraph';
    const next = '# Title\n\nParagraph';
    expect(hasMeaningfulDiff(next, prev)).toBe(false);
  });

  it('ignores unordered list marker differences (- vs *)', () => {
    const prev = '- item 1\n- item 2';
    const next = '* item 1\n* item 2';
    expect(hasMeaningfulDiff(next, prev)).toBe(false);
  });

  it('ignores unordered list marker differences (+ vs *)', () => {
    const prev = '+ item 1\n+ item 2';
    const next = '* item 1\n* item 2';
    expect(hasMeaningfulDiff(next, prev)).toBe(false);
  });

  it('ignores ordered list renumbering', () => {
    const prev = '1. first\n1. second\n1. third';
    const next = '1. first\n2. second\n3. third';
    expect(hasMeaningfulDiff(next, prev)).toBe(false);
  });

  it('detects ordered list content changes', () => {
    const prev = '1. apple\n2. banana';
    const next = '1. apple\n2. cherry';
    expect(hasMeaningfulDiff(next, prev)).toBe(true);
  });

  it('ignores thematic break style differences', () => {
    expect(hasMeaningfulDiff('---', '***')).toBe(false);
    expect(hasMeaningfulDiff('---', '___')).toBe(false);
    expect(hasMeaningfulDiff('---', '- - -')).toBe(false);
    expect(hasMeaningfulDiff('---', '* * *')).toBe(false);
  });

  it('ignores missing space after heading marker', () => {
    const prev = '##Title';
    const next = '## Title';
    expect(hasMeaningfulDiff(next, prev)).toBe(false);
  });

  it('ignores __bold__ vs **bold** differences', () => {
    const prev = 'some __bold__ text';
    const next = 'some **bold** text';
    expect(hasMeaningfulDiff(next, prev)).toBe(false);
  });

  it('ignores CRLF vs LF', () => {
    const prev = '# Title\r\ntext\r\n';
    const next = '# Title\ntext\n';
    expect(hasMeaningfulDiff(next, prev)).toBe(false);
  });

  it('ignores combined roundtrip artifacts', () => {
    const prev = '- item 1\n\n\n- item 2\n\n---\n';
    const next = '* item 1\n\n* item 2\n\n***\n';
    expect(hasMeaningfulDiff(next, prev)).toBe(false);
  });

  it('preserves indented list markers', () => {
    const prev = '  - nested';
    const next = '  * nested';
    expect(hasMeaningfulDiff(next, prev)).toBe(false);
  });

  it('does not treat thematic break as list item', () => {
    const prev = '- - -';
    const next = '---';
    expect(hasMeaningfulDiff(next, prev)).toBe(false);
  });

  it('ignores &nbsp; entities', () => {
    const prev = '# Title\n\ntext';
    const next = '# Title\n\ntext\n\n&nbsp;';
    expect(hasMeaningfulDiff(next, prev)).toBe(false);
  });

  it('ignores non-breaking space characters', () => {
    const prev = 'hello world';
    const next = 'hello\u00A0world';
    expect(hasMeaningfulDiff(next, prev)).toBe(false);
  });

  it('ignores mailto autolink wrapping', () => {
    const prev = 'Contact user@example.com for info';
    const next = 'Contact [user@example.com](mailto:user@example.com) for info';
    expect(hasMeaningfulDiff(next, prev)).toBe(false);
  });

  it('preserves real link changes (not mailto)', () => {
    const prev = 'Visit example.com';
    const next = 'Visit [example.com](https://example.com)';
    expect(hasMeaningfulDiff(next, prev)).toBe(true);
  });

  it('ignores list indent 3-space to 2-space change', () => {
    const prev = '- parent\n   - nested';
    const next = '- parent\n  - nested';
    expect(hasMeaningfulDiff(next, prev)).toBe(false);
  });

  it('ignores list indent normalization for ordered lists', () => {
    const prev = '1. parent\n   1. nested';
    const next = '1. parent\n  1. nested';
    expect(hasMeaningfulDiff(next, prev)).toBe(false);
  });

  it('detects real indent level changes in lists', () => {
    const prev = '- parent\n  - nested';
    const next = '- parent\n    - deeply nested';
    expect(hasMeaningfulDiff(next, prev)).toBe(true);
  });
});

describe('stripTrailingPlaceholders', () => {
  it('strips trailing &nbsp; lines', () => {
    expect(stripTrailingPlaceholders('# Title\n\n&nbsp;\n')).toBe('# Title\n');
  });

  it('strips trailing empty lines', () => {
    expect(stripTrailingPlaceholders('# Title\n\n\n\n')).toBe('# Title\n');
  });

  it('strips trailing non-breaking space characters', () => {
    expect(stripTrailingPlaceholders('# Title\n\n\u00A0\n')).toBe('# Title\n');
  });

  it('strips multiple trailing placeholder lines', () => {
    expect(stripTrailingPlaceholders('# Title\n\n&nbsp;\n\n&nbsp;\n')).toBe('# Title\n');
  });

  it('preserves content without trailing placeholders', () => {
    const md = '# Title\nSome text\n';
    expect(stripTrailingPlaceholders(md)).toBe(md);
  });

  it('returns empty string when all lines are placeholders', () => {
    expect(stripTrailingPlaceholders('&nbsp;\n\n&nbsp;\n')).toBe('');
  });

  it('preserves &nbsp; in the middle of content', () => {
    expect(stripTrailingPlaceholders('before\n&nbsp;\nafter\n')).toBe('before\n&nbsp;\nafter\n');
  });
});
