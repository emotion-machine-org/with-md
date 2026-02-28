import { afterEach, describe, expect, it } from 'vitest';

import {
  buildWeb2MdSourceHeaders,
  DEFAULT_WEB2MD_ACCEPT_LANGUAGE,
  DEFAULT_WEB2MD_USER_AGENT,
} from '@/lib/with-md/web2md/request-headers';

const ENV_KEYS = [
  'WITHMD_WEB2MD_USER_AGENT',
  'WITHMD_WEB2MD_ACCEPT_LANGUAGE',
  'WITHMD_WEB2MD_HF_TOKEN',
] as const;

function clearHeaderEnv(): void {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
}

afterEach(() => {
  clearHeaderEnv();
});

describe('buildWeb2MdSourceHeaders', () => {
  it('uses defaults when env overrides are not set', () => {
    clearHeaderEnv();
    const headers = buildWeb2MdSourceHeaders('https://example.com/article', {
      defaultUserAgent: DEFAULT_WEB2MD_USER_AGENT,
      defaultAcceptLanguage: DEFAULT_WEB2MD_ACCEPT_LANGUAGE,
    });

    expect(headers['User-Agent']).toBe(DEFAULT_WEB2MD_USER_AGENT);
    expect(headers['Accept-Language']).toBe(DEFAULT_WEB2MD_ACCEPT_LANGUAGE);
    expect(headers.Cookie).toBeUndefined();
    expect(headers.Authorization).toBeUndefined();
  });

  it('adds Hugging Face bearer auth when configured', () => {
    process.env.WITHMD_WEB2MD_HF_TOKEN = 'hf_xxx';
    const headers = buildWeb2MdSourceHeaders('https://huggingface.co/spaces/demo/app');

    expect(headers.Cookie).toBeUndefined();
    expect(headers.Authorization).toBe('Bearer hf_xxx');
  });
});
