import { z } from 'zod';

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
    // GitHub App — required for the agent to operate
    GITHUB_APP_ID: z.string().min(1),
    GITHUB_APP_PRIVATE_KEY: z.string().min(1),
    GITHUB_WEBHOOK_SECRET: z.string().min(1),
    // AI providers — at least one should be set
    OPENAI_API_KEY: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    MINIMAX_API_KEY: z.string().optional(),
    // Pro/hosted-only (optional in OSS)
    DATABASE_URL: z.string().optional(),
    TRIGGER_SECRET_KEY: z.string().optional(),
    TRIGGER_PROJECT_ID: z.string().optional(),
    STRIPE_SECRET_KEY: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),
  })
  .refine(
    (data) =>
      process.env.NODE_ENV === 'test' ||
      !!(data.OPENAI_API_KEY || data.ANTHROPIC_API_KEY || data.MINIMAX_API_KEY),
    { message: 'At least one AI provider API key is required (OPENAI_API_KEY, ANTHROPIC_API_KEY, or MINIMAX_API_KEY)' },
  );

export type Env = z.infer<typeof envSchema>;

export function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid env:', result.error.flatten().fieldErrors);
    throw new Error('Invalid environment variables');
  }
  return result.data;
}

/**
 * Returns the DATABASE_URL for hosted/Pro features.
 * Throws a clear error in OSS mode when DATABASE_URL is not configured.
 */
export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is required for this feature — it is a hosted/Pro-only capability and not available in OSS mode.',
    );
  }
  return url;
}
