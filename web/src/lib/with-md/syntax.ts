import type { SyntaxSupportResult } from '@/lib/with-md/types';

const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n/;
const DIRECTIVE_RE = /^:{2,}\w+/m;
const GFM_TABLE_DIVIDER_RE = /^\|?\s*:?-{3,}(?:\s*\|\s*:?-{3,})+\s*\|?\s*$/m;
const FENCED_CODE_RE = /(^|\n)(```|~~~)[^\n]*\n[\s\S]*?\n\2(?=\n|$)/g;
const INLINE_CODE_RE = /`[^`\n]+`/g;
const JSX_TAG_RE = /(^|\n)\s*<\/?[A-Za-z][\w-]*(?:\s+[^>\n]*)?\s*\/?>/m;
const JSX_EXPR_LINE_RE = /(^|\n)\s*\{[A-Za-z_$][\w$]*(?:\.[\w$]+)*(?:\([^)]*\))?\}\s*(?=\n|$)/m;

function stripCodeSegments(markdown: string): string {
  return markdown.replace(FENCED_CODE_RE, '\n').replace(INLINE_CODE_RE, '');
}

export function detectUnsupportedSyntax(markdown: string): SyntaxSupportResult {
  const reasons: string[] = [];
  const sanitized = stripCodeSegments(markdown);

  if (FRONTMATTER_RE.test(markdown)) reasons.push('frontmatter');
  if (DIRECTIVE_RE.test(markdown)) reasons.push('directives');
  if (GFM_TABLE_DIVIDER_RE.test(sanitized)) reasons.push('gfm_table');
  if (JSX_TAG_RE.test(sanitized) || JSX_EXPR_LINE_RE.test(sanitized)) {
    reasons.push('mdx_or_embedded_jsx');
  }

  return {
    supported: reasons.length === 0,
    reasons,
  };
}
