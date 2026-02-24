const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n/;
const MDX_RE = /<\w+[\s\S]*?>|\{[^\n]*\}/;
const DIRECTIVE_RE = /^:{2,}\w+/m;
const FENCED_CODE_RE = /(^|\n)(```|~~~)[^\n]*\n[\s\S]*?\n\2(?=\n|$)/g;
const INLINE_CODE_RE = /`[^`\n]+`/g;

function stripCodeSegments(markdown: string): string {
  return markdown.replace(FENCED_CODE_RE, '\n').replace(INLINE_CODE_RE, '');
}

export function detectUnsupportedSyntax(markdown: string): { supported: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const sanitized = stripCodeSegments(markdown);

  if (FRONTMATTER_RE.test(markdown)) reasons.push('frontmatter');
  if (DIRECTIVE_RE.test(markdown)) reasons.push('directives');
  if (MDX_RE.test(sanitized)) reasons.push('mdx_or_embedded_jsx');

  return {
    supported: reasons.length === 0,
    reasons,
  };
}
