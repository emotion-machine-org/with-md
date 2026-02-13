import type { SyntaxSupportResult } from '@/lib/with-md/types';

const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n/;
const MDX_RE = /<\w+[\s\S]*?>|\{[^\n]*\}/;
const DIRECTIVE_RE = /^:{2,}\w+/m;

export function detectUnsupportedSyntax(markdown: string): SyntaxSupportResult {
  const reasons: string[] = [];

  if (FRONTMATTER_RE.test(markdown)) reasons.push('frontmatter');
  if (DIRECTIVE_RE.test(markdown)) reasons.push('directives');
  if (MDX_RE.test(markdown)) reasons.push('mdx_or_embedded_jsx');

  return {
    supported: reasons.length === 0,
    reasons,
  };
}
