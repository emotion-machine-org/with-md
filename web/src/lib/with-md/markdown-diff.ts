export function hasMeaningfulDiff(nextMarkdown: string, prevMarkdown: string): boolean {
  const normalize = (value: string) =>
    value
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+$/gm, '')
      .replace(/__([^_]+)__/g, '**$1**')
      .trim();

  return normalize(nextMarkdown) !== normalize(prevMarkdown);
}
