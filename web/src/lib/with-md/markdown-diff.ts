export function stripTrailingPlaceholders(markdown: string): string {
  const lines = markdown.split('\n');
  let end = lines.length;
  while (end > 0) {
    const line = lines[end - 1].replace(/\u00A0/g, ' ').trim();
    if (line === '' || line === '&nbsp;') {
      end -= 1;
      continue;
    }
    break;
  }
  if (end >= lines.length) return markdown;
  if (end === 0) return '';
  return lines.slice(0, end).join('\n') + '\n';
}

export function hasMeaningfulDiff(nextMarkdown: string, prevMarkdown: string): boolean {
  const normalize = (value: string) =>
    value
      .replace(/\r\n/g, '\n')                                  // CRLF → LF
      .replace(/[ \t]+$/gm, '')                                 // strip trailing whitespace per line
      .replace(/\n{3,}/g, '\n\n')                               // collapse multiple blank lines to one
      .replace(/__([^_]+)__/g, '**$1**')                        // __bold__ → **bold**
      .replace(/^([-*_])([ \t]*\1){2,}[ \t]*$/gm, '---')       // normalize thematic breaks → ---
      .replace(/&nbsp;/g, ' ')                                   // &nbsp; → space
      .replace(/\u00A0/g, ' ')                                  // non-breaking space → space
      .replace(/\[([^\]]+)\]\(mailto:\1\)/g, '$1')              // [email](mailto:email) → email
      .replace(/^(\s*)[+-]( )/gm, '$1*$2')                     // unordered list markers → *
      .replace(/^(\s*)\d+(?=\. )/gm, '$11')                    // ordered list numbers → 1
      .replace(/^(#{1,6})([^ #\n])/gm, '$1 $2')                // ensure space after # in headings
      .replace(/^( +)(?=[*\-+] |\d+\. )/gm, (m) =>            // normalize list indent to multiples of 2
        ' '.repeat(Math.floor(m.length / 2) * 2))
      .trim();

  return normalize(nextMarkdown) !== normalize(prevMarkdown);
}
