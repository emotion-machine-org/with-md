import { describe, expect, test } from 'vitest';

import { buildLinkPreview, titleFromMarkdown, titleFromPath } from '@/lib/with-md/link-preview';

describe('link preview helpers', () => {
  test('derives a clean title from a markdown heading', () => {
    expect(titleFromMarkdown('---\ndraft: true\n---\n\n# Project Alpha\n\nShip it.')).toBe('Project Alpha');
  });

  test('uses a real markdown heading when the stored title is generic', () => {
    const preview = buildLinkPreview({
      content: '# Project Alpha\n\n- First milestone\n- [Planning doc](https://example.com)',
      fallbackDescription: 'Open a markdown share.',
      fallbackTitle: 'Shared markdown on with.md',
      label: 'anonymous share',
      preferredTitle: 'Shared Document',
    });

    expect(preview.title).toBe('Project Alpha');
    expect(preview.metaTitle).toBe('Project Alpha - with.md');
    expect(preview.description).toBe('First milestone Planning doc');
  });

  test('turns markdown content into a compact preview excerpt', () => {
    const preview = buildLinkPreview({
      content: [
        '# Launch checklist',
        '',
        '- [x] Final copy',
        '- Add ![hero screenshot](https://example.com/hero.png)',
        '',
        '| Step | Owner |',
        '| --- | --- |',
        '| QA | Sam |',
        '',
        '```ts',
        'const internal = true;',
        '```',
      ].join('\n'),
      fallbackDescription: 'Open a markdown share.',
      fallbackTitle: 'Shared markdown on with.md',
      label: 'anonymous share',
      preferredTitle: 'Launch checklist',
    });

    expect(preview.description).toBe('Final copy Add hero screenshot Step Owner QA Sam');
  });

  test('derives a readable title from a repository file path', () => {
    expect(titleFromPath('docs/growth/project-plan.md')).toBe('project-plan');
    expect(titleFromPath('docs/research/readme.markdown')).toBe('readme');
  });
});
