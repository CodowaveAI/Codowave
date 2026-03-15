import { defineConfig } from '@trigger.dev/sdk/v3';
import type { TriggerConfig } from '@trigger.dev/sdk/v3';

const config: TriggerConfig = defineConfig({
  project: process.env.TRIGGER_PROJECT_ID!,
  runtime: 'node',
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      factor: 2,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 60000,
    },
  },
  logLevel: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
});

export default config;
