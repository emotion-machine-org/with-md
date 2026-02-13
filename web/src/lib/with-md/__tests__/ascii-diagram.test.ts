import { describe, expect, it } from 'vitest';

import { normalizeAsciiDiagramBlocks } from '@/lib/with-md/ascii-diagram';

describe('normalizeAsciiDiagramBlocks', () => {
  it('wraps diagram-like blocks in fenced text code blocks', () => {
    const input = [
      '# Architecture',
      '',
      '┌──────┐      ┌──────┐',
      '│ Git  │ ───▶ │ Web  │',
      '└──────┘      └──────┘',
      '',
      'Tail paragraph.',
    ].join('\n');

    const output = normalizeAsciiDiagramBlocks(input);
    expect(output).toContain('```text');
    expect(output).toContain('│ Git  │ ───▶ │ Web  │');
    expect(output).toContain('```');
  });

  it('does not alter already fenced diagrams', () => {
    const input = [
      '```text',
      '┌──────┐',
      '└──────┘',
      '```',
    ].join('\n');

    expect(normalizeAsciiDiagramBlocks(input)).toBe(input);
  });
});
