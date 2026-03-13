import { createOpenAI } from '@ai-sdk/openai';
import { generateText, generateObject, streamObject } from 'ai';

/**
 * AI provider — configured via environment variables.
 * Defaults to MiniMax (OpenAI-compatible), but works with any compatible provider.
 *
 * Required env:
 *   AI_BASE_URL   — provider base URL (default: https://api.minimax.chat/v1)
 *   AI_API_KEY    — API key (falls back to MINIMAX_API_KEY, OPENAI_API_KEY)
 *   AI_MODEL      — model name (default: MiniMax-Text-01)
 *   AI_FAST_MODEL — fast/cheap model for lightweight tasks (default: same as AI_MODEL)
 */
export const aiProvider = createOpenAI({
  baseURL: process.env.AI_BASE_URL ?? 'https://api.minimax.chat/v1',
  apiKey:
    process.env.AI_API_KEY ??
    process.env.MINIMAX_API_KEY ??
    process.env.OPENAI_API_KEY ??
    '',
  compatibility: 'compatible',
});

export const DEFAULT_MODEL =
  process.env.AI_MODEL ?? 'MiniMax-Text-01';

export const FAST_MODEL =
  process.env.AI_FAST_MODEL ?? process.env.AI_MODEL ?? 'MiniMax-Text-01';

export { generateText, generateObject, streamObject };
