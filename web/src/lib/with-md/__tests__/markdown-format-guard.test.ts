import { describe, expect, it } from 'vitest';

import {
  extractProtectedMarkdownTokens,
  findProtectedMarkdownLoss,
  protectMarkdownSave,
} from '@/lib/with-md/markdown-format-guard';

describe('markdown format guard', () => {
  it('detects image markdown that was serialized to caption text', () => {
    const before = '# Release\n\n![Flow diagram](https://example.com/flow.png)\n\nReady.';
    const after = '# Release\n\nFlow diagram\n\nReady with edits.';

    const loss = findProtectedMarkdownLoss(before, after);

    expect(loss?.missing.map((item) => item.kind)).toContain('image');
  });

  it('keeps original image markdown when a fallback edit would save only the caption', () => {
    const before = '# Release\n\n![Flow diagram](https://example.com/flow.png)\n\nReady.';
    const after = '# Release\n\nFlow diagram\n\nReady with edits.';

    const decision = protectMarkdownSave(before, after);

    expect(decision.safe).toBe(false);
    expect(decision.content).toBe(before);
    if (!decision.safe) {
      expect(decision.loss.missing[0]?.kind).toBe('image');
    }
  });

  it('allows edits when protected markdown is still present', () => {
    const before = [
      '# Release',
      '',
      '[Launch note](https://example.com)',
      '',
      '| Step | Status |',
      '|---|---|',
      '| Upload | Done |',
      '',
      '```ts',
      'const ok = true;',
      '```',
    ].join('\n');
    const after = `${before}\n\nExtra paragraph.`;

    expect(findProtectedMarkdownLoss(before, after)).toBeNull();
  });

  it('tracks links, tables, code fences, task lists, and html as protected syntax', () => {
    const markdown = [
      '- [x] keep this task',
      '',
      '[Launch note](https://example.com)',
      '',
      '<aside>raw html</aside>',
      '',
      '| Step | Status |',
      '|---|---|',
      '| Upload | Done |',
      '',
      '```mermaid',
      'graph TD',
      '```',
    ].join('\n');

    expect(extractProtectedMarkdownTokens(markdown).map((item) => item.kind)).toEqual(
      expect.arrayContaining(['task_list', 'link', 'html', 'table', 'code']),
    );
  });

  it('counts duplicate protected tokens before allowing a save', () => {
    const before = [
      '![Chart](https://example.com/chart.png)',
      '![Chart](https://example.com/chart.png)',
    ].join('\n\n');
    const after = '![Chart](https://example.com/chart.png)\n\nChart';

    const loss = findProtectedMarkdownLoss(before, after);

    expect(loss?.missing).toHaveLength(1);
    expect(loss?.missing[0]?.kind).toBe('image');
  });
});
