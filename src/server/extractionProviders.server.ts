import type { AiExtractionProvider } from '@/types/extractionProvider';

export type ExtractionClient = {
  models: { generateContent(params: any): Promise<{ text?: string }> };
};

const SUPPORTED_PROVIDERS = new Set<AiExtractionProvider>(['google', 'openai', 'anthropic']);

function safeProviderMessage(payload: any, fallback: string): string {
  const message = payload?.error?.message ?? payload?.message ?? payload?.detail ?? fallback;
  return String(message).replace(/\s+/g, ' ').trim().slice(0, 300);
}

async function providerError(res: Response, provider: string): Promise<Error> {
  const payload = await res.json().catch(() => null);
  return new Error(`${res.status} ${provider}: ${safeProviderMessage(payload, res.statusText)}`);
}

function geminiSchema(value: any): any {
  if (Array.isArray(value)) return value.map(geminiSchema);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, key === 'type' && typeof item === 'string' ? item.toUpperCase() : geminiSchema(item)]),
  );
}

function createGoogleClient(apiKey: string): ExtractionClient {
  return {
    models: {
      async generateContent(params: any) {
        const parts = (params?.contents?.parts ?? []).map((part: any) =>
          part.text !== undefined
            ? { text: part.text }
            : { inline_data: { mime_type: part.inlineData.mimeType, data: part.inlineData.data } },
        );
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(params.model)}:generateContent`, {
          method: 'POST',
          headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: geminiSchema(params?.config?.responseSchema),
              maxOutputTokens: 16384,
            },
          }),
        });
        if (!res.ok) throw await providerError(res, 'Google Gemini');
        const json: any = await res.json();
        const text = (json?.candidates?.[0]?.content?.parts ?? [])
          .map((part: any) => part?.text || '')
          .join('')
          .trim();
        if (!text) throw new Error('422 Google Gemini returned no readable extraction.');
        return { text };
      },
    },
  };
}

function createOpenAIClient(apiKey: string): ExtractionClient {
  return {
    models: {
      async generateContent(params: any) {
        const content = (params?.contents?.parts ?? []).map((part: any) => {
          if (part.text !== undefined) return { type: 'input_text', text: part.text };
          const { mimeType, data } = part.inlineData;
          if (mimeType === 'application/pdf') {
            return { type: 'input_file', filename: 'layout.pdf', file_data: `data:application/pdf;base64,${data}` };
          }
          return { type: 'input_image', image_url: `data:${mimeType};base64,${data}` };
        });
        const res = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: params.model,
            input: [{ role: 'user', content }],
            max_output_tokens: 16384,
            text: {
              format: {
                type: 'json_schema',
                name: 'layout_extraction',
                strict: false,
                schema: params?.config?.responseSchema,
              },
            },
          }),
        });
        if (!res.ok) throw await providerError(res, 'OpenAI');
        const json: any = await res.json();
        const text = json?.output_text || (json?.output ?? [])
          .flatMap((item: any) => item?.content ?? [])
          .filter((item: any) => item?.type === 'output_text')
          .map((item: any) => item?.text || '')
          .join('');
        if (!String(text).trim()) throw new Error('422 OpenAI returned no readable extraction.');
        return { text: String(text).trim() };
      },
    },
  };
}

function createAnthropicClient(apiKey: string): ExtractionClient {
  return {
    models: {
      async generateContent(params: any) {
        const content = (params?.contents?.parts ?? []).map((part: any) => {
          if (part.text !== undefined) return { type: 'text', text: part.text };
          const { mimeType, data } = part.inlineData;
          if (mimeType === 'application/pdf') {
            return { type: 'document', source: { type: 'base64', media_type: mimeType, data } };
          }
          return { type: 'image', source: { type: 'base64', media_type: mimeType, data } };
        });
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: params.model,
            max_tokens: 16384,
            messages: [{ role: 'user', content }],
            tools: [{
              name: 'extract_layout',
              description: 'Return only signalling entities explicitly supported by the attached drawing.',
              input_schema: params?.config?.responseSchema,
            }],
            tool_choice: { type: 'tool', name: 'extract_layout' },
          }),
        });
        if (!res.ok) throw await providerError(res, 'Anthropic Claude');
        const json: any = await res.json();
        const toolUse = (json?.content ?? []).find((item: any) => item?.type === 'tool_use' && item?.name === 'extract_layout');
        if (!toolUse?.input) throw new Error('422 Anthropic Claude returned no readable extraction.');
        return { text: JSON.stringify(toolUse.input) };
      },
    },
  };
}

export function createExtractionClient(provider: AiExtractionProvider, apiKey?: string): ExtractionClient | null {
  if (!SUPPORTED_PROVIDERS.has(provider)) throw new Error('400 Unsupported AI provider.');
  const cleanKey = String(apiKey || '').trim();
  if (cleanKey.length > 512) throw new Error('400 API key is too long.');
  if (!cleanKey) throw new Error(`API_KEY_REQUIRED ${provider}`);
  if (provider === 'google') return createGoogleClient(cleanKey);
  if (provider === 'openai') return createOpenAIClient(cleanKey);
  return createAnthropicClient(cleanKey);
}

export function modelsForProvider(provider: AiExtractionProvider): string[] {
  if (provider === 'google') return ['gemini-3.8-flash'];
  if (provider === 'openai') return ['gpt-4.1-mini'];
  if (provider === 'anthropic') return ['claude-sonnet-4-20250514'];
  return [];
}
