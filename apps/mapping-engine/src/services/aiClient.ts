/**
 * AI provider factory for the mapping-engine.
 *
 * Controlled by the AI_PROVIDER env var:
 *   azure            — Azure OpenAI  (default, existing behaviour)
 *   openai           — api.openai.com
 *   openai-compatible — any OpenAI-compatible endpoint (Groq, Ollama, Together, etc.)
 *
 * Env vars:
 *   AI_PROVIDER=azure | openai | openai-compatible
 *
 *   Azure:
 *     AZURE_OPENAI_API_KEY
 *     AZURE_OPENAI_ENDPOINT
 *     AZURE_OPENAI_DEPLOYMENT   (also used as model name)
 *     AZURE_OPENAI_API_VERSION  (default: 2024-08-01-preview)
 *
 *   OpenAI / OpenAI-compatible:
 *     OPENAI_API_KEY
 *     OPENAI_MODEL              (default: gpt-4o-mini)
 *     OPENAI_BASE_URL           (optional, only needed for openai-compatible)
 */

import OpenAI, { AzureOpenAI } from 'openai';

export type AIClient = OpenAI | AzureOpenAI;

let _client: AIClient | null = null;

export function getAIClient(): AIClient {
  if (_client) return _client;

  const provider = (process.env.AI_PROVIDER ?? 'azure').toLowerCase();

  if (provider === 'azure') {
    _client = new AzureOpenAI({
      apiKey:     process.env.AZURE_OPENAI_API_KEY,
      endpoint:   process.env.AZURE_OPENAI_ENDPOINT,
      apiVersion: process.env.AZURE_OPENAI_API_VERSION ?? '2024-08-01-preview',
    });
  } else if (provider === 'openai') {
    _client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  } else if (provider === 'openai-compatible') {
    _client = new OpenAI({
      apiKey:  process.env.OPENAI_API_KEY ?? 'not-needed',
      baseURL: process.env.OPENAI_BASE_URL,
    });
  } else {
    throw new Error(`Unknown AI_PROVIDER "${provider}". Must be azure | openai | openai-compatible`);
  }

  return _client;
}

/** Returns the model/deployment name to use in chat.completions.create() */
export function getAIModel(): string {
  const provider = (process.env.AI_PROVIDER ?? 'azure').toLowerCase();
  if (provider === 'azure') {
    return process.env.AZURE_OPENAI_DEPLOYMENT ?? 'gpt-4o-mini';
  }
  return process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
}
