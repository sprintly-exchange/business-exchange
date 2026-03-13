/**
 * AI provider factory for the mapping-engine.
 *
 * Two modes:
 *   1. Platform singleton — reads AI_PROVIDER + associated env vars (existing behaviour).
 *   2. Per-request client  — built from a PartnerLLMConfig passed at call time (BYOLLM).
 *
 * Supported providers: azure | openai | openai-compatible
 */

import OpenAI, { AzureOpenAI } from 'openai';
import type { PartnerLLMConfig } from '@bx/shared-types';

export type AIClient = OpenAI | AzureOpenAI;

// ── Platform singleton (env-based) ──────────────────────────────────────────
let _platformClient: AIClient | null = null;

function buildClientFromEnv(): AIClient {
  const provider = (process.env.AI_PROVIDER ?? 'azure').toLowerCase();

  if (provider === 'azure') {
    return new AzureOpenAI({
      apiKey:     process.env.AZURE_OPENAI_API_KEY,
      endpoint:   process.env.AZURE_OPENAI_ENDPOINT,
      apiVersion: process.env.AZURE_OPENAI_API_VERSION ?? '2024-08-01-preview',
    });
  }
  if (provider === 'openai') {
    return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  if (provider === 'openai-compatible') {
    return new OpenAI({
      apiKey:  process.env.OPENAI_API_KEY ?? 'not-needed',
      baseURL: process.env.OPENAI_BASE_URL,
    });
  }
  throw new Error(`Unknown AI_PROVIDER "${provider}". Must be azure | openai | openai-compatible`);
}

/** Returns the platform-level singleton AI client (env-configured). */
export function getAIClient(): AIClient {
  if (!_platformClient) _platformClient = buildClientFromEnv();
  return _platformClient;
}

/** Returns the platform-level model/deployment name. */
export function getAIModel(): string {
  const provider = (process.env.AI_PROVIDER ?? 'azure').toLowerCase();
  return provider === 'azure'
    ? (process.env.AZURE_OPENAI_DEPLOYMENT ?? 'gpt-4o-mini')
    : (process.env.OPENAI_MODEL ?? 'gpt-4o-mini');
}

// ── Per-partner client (BYOLLM) ─────────────────────────────────────────────

/** Builds a fresh AI client from a partner's own LLM config. */
export function createAIClient(config: PartnerLLMConfig): AIClient {
  if (config.provider === 'azure') {
    return new AzureOpenAI({
      apiKey:     config.apiKey,
      endpoint:   config.endpoint,
      apiVersion: process.env.AZURE_OPENAI_API_VERSION ?? '2024-08-01-preview',
    });
  }
  if (config.provider === 'openai') {
    return new OpenAI({ apiKey: config.apiKey });
  }
  // openai-compatible (Groq, Ollama, LM Studio, Together, etc.)
  // Normalize endpoint: strip trailing slash, add /v1 if not already present.
  const base = (config.endpoint ?? '').replace(/\/+$/, '');
  const baseURL = base.endsWith('/v1') ? base : `${base}/v1`;
  return new OpenAI({
    apiKey:  config.apiKey || 'not-needed',
    baseURL,
  });
}
