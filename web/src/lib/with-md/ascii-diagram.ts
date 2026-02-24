const FENCE_RE = /^\s*(```|~~~)/;
const BOX_DRAWING_RE = /[┌┐└┘├┤┬┴┼─│◀▶▲▼]/;
const CONNECTOR_RE = /[|_\\/<>-]/g;
const LONG_STROKE_RE = /[-_]{5,}|[|]{4,}|[─]{3,}|<[-=]{2,}|[-=]{2,}>/;

function isListOrTableLine(line: string): boolean {
  const trimmed = line.trim();
  if (/^([*-]|\d+\.)\s+/.test(trimmed)) return true;
  if (/^\|.+\|$/.test(trimmed)) return true;
  if (/^\|?\s*:?-{3,}/.test(trimmed)) return true;
  return false;
}

export function isAsciiDiagramLine(line: string): boolean {
  const trimmed = line.trimEnd();
  if (!trimmed.trim()) return false;
  if (FENCE_RE.test(trimmed)) return false;
  if (isListOrTableLine(trimmed)) return false;
  if (BOX_DRAWING_RE.test(trimmed)) return true;
  if (trimmed.length < 24) return false;

  const connectors = (trimmed.match(CONNECTOR_RE) ?? []).length;
  const alphaNum = (trimmed.match(/[A-Za-z0-9]/g) ?? []).length;

  if (connectors < 8) return false;
  if (!LONG_STROKE_RE.test(trimmed) && connectors < 12) return false;

  return connectors >= alphaNum * 0.45;
}

export function normalizeAsciiDiagramBlocks(markdown: string): string {
  if (!markdown.includes('\n')) return markdown;

  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];

  let i = 0;
  let inFence = false;
  let fenceToken = '';

  while (i < lines.length) {
    const line = lines[i];
    const fenceMatch = line.match(/^\s*(```|~~~)/);
    if (fenceMatch) {
      const token = fenceMatch[1];
      if (!inFence) {
        inFence = true;
        fenceToken = token;
      } else if (token === fenceToken) {
        inFence = false;
        fenceToken = '';
      }
      out.push(line);
      i += 1;
      continue;
    }

    if (inFence || !isAsciiDiagramLine(line)) {
      out.push(line);
      i += 1;
      continue;
    }

    const block: string[] = [];
    while (i < lines.length && isAsciiDiagramLine(lines[i])) {
      block.push(lines[i]);
      i += 1;
    }

    const hasBoxDrawing = block.some((entry) => BOX_DRAWING_RE.test(entry));
    const shouldWrap = hasBoxDrawing || block.length >= 3;
    if (!shouldWrap) {
      out.push(...block);
      continue;
    }

    out.push('```text');
    out.push(...block);
    out.push('```');
  }

  return out.join('\n');
}
