const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n/;
const DIRECTIVE_RE = /^:{2,}\w+/m;
const FENCED_CODE_RE = /(^|\n)(```|~~~)[^\n]*\n[\s\S]*?\n\2(?=\n|$)/g;
const INLINE_CODE_RE = /`[^`\n]+`/g;
const IMAGE_RE = /!\[(?:\\.|[^\]\\\n]|\[[^\]\n]*\])*\]\([^)\n]+\)/;
const REFERENCE_IMAGE_RE = /!\[(?:\\.|[^\]\\\n]|\[[^\]\n]*\])*\]\[(?:\\.|[^\]\\\n]|\[[^\]\n]*\])*\]/;
const REFERENCE_LINK_RE = /(^|[^!])\[[^\]\n]+\]\[[^\]\n]*\]/;
const REFERENCE_DEFINITION_RE = /^[ \t]{0,3}\[[^\]\n]+]:[ \t]+\S.*$/m;
const JSX_TAG_RE = /(^|\n)\s*<\/?[A-Za-z][\w-]*(?:\s+[^>\n]*)?\s*\/?>/m;
const JSX_EXPR_LINE_RE = /(^|\n)\s*\{[A-Za-z_$][\w$]*(?:\.[\w$]+)*(?:\([^)]*\))?\}\s*(?=\n|$)/m;

function stripCodeSegments(markdown: string): string {
  return markdown.replace(FENCED_CODE_RE, '\n').replace(INLINE_CODE_RE, '');
}

export function detectUnsupportedSyntax(markdown: string): { supported: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const sanitized = stripCodeSegments(markdown);

  if (FRONTMATTER_RE.test(markdown)) reasons.push('frontmatter');
  if (DIRECTIVE_RE.test(markdown)) reasons.push('directives');
  if (IMAGE_RE.test(sanitized) || REFERENCE_IMAGE_RE.test(sanitized)) {
    reasons.push('images');
  }
  if (REFERENCE_LINK_RE.test(sanitized) || REFERENCE_DEFINITION_RE.test(sanitized)) {
    reasons.push('reference_links');
  }
  if (JSX_TAG_RE.test(sanitized) || JSX_EXPR_LINE_RE.test(sanitized)) {
    reasons.push('mdx_or_embedded_jsx');
  }

  return {
    supported: reasons.length === 0,
    reasons,
  };
}
