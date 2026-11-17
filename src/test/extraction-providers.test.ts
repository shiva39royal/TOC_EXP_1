import { describe, expect, it } from 'vitest';
import { createExtractionClient, modelsForProvider } from '@/server/extractionProviders.server';

describe('explicit online extraction providers', () => {
  it('requires a user key for every supported online provider', () => {
    expect(() => createExtractionClient('openai')).toThrow('API_KEY_REQUIRED');
    expect(() => createExtractionClient('google')).toThrow('API_KEY_REQUIRED');
    expect(() => createExtractionClient('anthropic')).toThrow('API_KEY_REQUIRED');
    expect(() => createExtractionClient('google', 'user-key')).not.toThrow();
  });

  it('uses only the selected external provider model', () => {
    expect(modelsForProvider('google')).toEqual(['gemini-3.8-flash']);
    expect(modelsForProvider('openai')).toEqual(['gpt-4.1-mini']);
    expect(modelsForProvider('anthropic')).toEqual(['claude-sonnet-4-20250514']);
  });
});
