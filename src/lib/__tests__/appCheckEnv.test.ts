import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getAppCheckConfig } from '../firebase/env';

describe('getAppCheckConfig', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns null if VITE_RECAPTCHA_SITE_KEY is not set', () => {
    vi.stubEnv('VITE_RECAPTCHA_SITE_KEY', '');
    expect(getAppCheckConfig()).toBeNull();
  });

  it('allows debugEnabled and debugToken in DEV environment', () => {
    vi.stubEnv('VITE_RECAPTCHA_SITE_KEY', 'test-site-key');
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_APPCHECK_DEBUG', 'true');
    vi.stubEnv('VITE_APPCHECK_DEBUG_TOKEN', 'debug-token-123');

    const config = getAppCheckConfig();
    expect(config).not.toBeNull();
    expect(config?.recaptchaSiteKey).toBe('test-site-key');
    expect(config?.debugEnabled).toBe(true);
    expect(config?.debugToken).toBe('debug-token-123');
  });

  it('blocks debugEnabled and debugToken when DEV is false (production build)', () => {
    vi.stubEnv('VITE_RECAPTCHA_SITE_KEY', 'test-site-key');
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_APPCHECK_DEBUG', 'true');
    vi.stubEnv('VITE_APPCHECK_DEBUG_TOKEN', 'debug-token-123');

    const config = getAppCheckConfig();
    expect(config).not.toBeNull();
    expect(config?.recaptchaSiteKey).toBe('test-site-key');
    expect(config?.debugEnabled).toBe(false);
    expect(config?.debugToken).toBeUndefined();
  });
});
