export function hasMeaningfulDiff(nextMarkdown: string, prevMarkdown: string): boolean {
  const normalize = (value: string) =>
    value
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+$/gm, '')
      .replace(/__([^_]+)__/g, '**$1**')
      .trim();

  return normalize(nextMarkdown) !== normalize(prevMarkdown);
}

export function hashContent(content: string): string {
  let hash = 5381;
  for (let i = 0; i < content.length; i += 1) {
    hash = (hash * 33) ^ content.charCodeAt(i);
  }
  return `h_${(hash >>> 0).toString(16)}`;
}
