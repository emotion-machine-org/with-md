export interface OpenRouterDistillInput {
  targetUrl: string;
  sourceTitle?: string;
  sourceText: string;
  draftMarkdown: string;
  apiKey: string;
  model?: string;
}

export interface OpenRouterDistillResult {
  markdown: string;
  tokenEstimate?: number;
}

const DEFAULT_MODEL = 'openai/gpt-oss-20b';

function normalizeMarkdown(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  const fenced = trimmed.match(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/i);
  const unwrapped = fenced ? fenced[1] : trimmed;

  return `${unwrapped
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`;
}

function clampText(input: string, maxChars: number): string {
  if (input.length <= maxChars) return input;
  return `${input.slice(0, maxChars)}\n\n[truncated]`;
}

export async function distillWithOpenRouter(input: OpenRouterDistillInput): Promise<OpenRouterDistillResult> {
  const key = input.apiKey.trim();
  if (!key) {
    throw new Error('Missing OpenRouter API key.');
  }

  const model = input.model?.trim() || process.env.WITHMD_WEB2MD_LLM_MODEL || DEFAULT_MODEL;
  const sourceText = clampText(input.sourceText, 18000);
  const draftMarkdown = clampText(input.draftMarkdown, 20000);

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'https://with.md',
      'X-Title': 'with.md web2md',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      provider: {
        order: ['Groq'],
        allow_fallbacks: true,
      },
      messages: [
        {
          role: 'system',
          content: 'You convert web article content into clean markdown. Preserve facts, structure, links, and code. Do not add information. Output markdown only, no prose outside markdown.',
        },
        {
          role: 'user',
          content: [
            `URL: ${input.targetUrl}`,
            input.sourceTitle ? `Title: ${input.sourceTitle}` : null,
            '',
            'SOURCE_TEXT:',
            sourceText,
            '',
            'DRAFT_MARKDOWN:',
            draftMarkdown,
            '',
            'Return cleaned markdown only.',
          ].filter(Boolean).join('\n'),
        },
      ],
    }),
  });

  const data = await response.json().catch(() => null) as
    | {
      choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
      usage?: { total_tokens?: number };
      error?: { message?: string };
    }
    | null;

  if (!response.ok) {
    const message = data?.error?.message || `OpenRouter request failed with ${response.status}`;
    throw new Error(message);
  }

  const content = data?.choices?.[0]?.message?.content;
  const raw = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content
        .filter((part) => (part.type ?? 'text') === 'text')
        .map((part) => part.text ?? '')
        .join('')
      : '';

  const markdown = normalizeMarkdown(raw);
  if (!markdown) {
    throw new Error('OpenRouter returned empty markdown.');
  }

  return {
    markdown,
    tokenEstimate: data?.usage?.total_tokens,
  };
}
