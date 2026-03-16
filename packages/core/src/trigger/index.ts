/**
 * Trigger.dev v3 SDK integration for Codowave
 *
 * This module provides Trigger.dev task definitions and utilities.
 * Configuration is handled via trigger.config.ts
 */

// Re-export core SDK types and functions
export {
  // Task definitions
  task,
  schemaTask,
  toolTask,
  tasks,
  type Task,
  type TaskOptions,
  type TaskPayload,
  type TaskOutput,
  type TaskIdentifier,
  type TaskRunResult,
  type RunHandle,
  // Batch tasks
  batch,
  type BatchItem,
  type BatchResult,
  type BatchRunHandle,
  // Wait delays
  wait,
  // Background waitUntil
  waitUntil,
  // Scheduled tasks
  schedules,
  // Retry configuration
  retry,
  type RetryOptions,
  // Queue
  queue,
  type Queue,
  // Usage
  usage,
  // Idempotency keys
  idempotencyKeys,
  // Tags
  tags,
  // Metadata
  metadata,
  // Timeout
  timeout,
  // Webhooks
  webhooks,
  // Error types
  ApiError,
  AuthenticationError,
  BadRequestError,
  ConflictError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  UnprocessableEntityError,
  AbortTaskRunError,
  OutOfMemoryError,
  SubtaskUnwrapError,
  // Logger
  logger,
  type LogLevel,
  // Run utilities
  runs,
  type RunShape,
  type AnyRunShape,
  type TaskRunShape,
  type RealtimeRun,
  type AnyRealtimeRun,
  type RetrieveRunResult,
  type AnyRetrieveRunResult,
  // Environment variables
  envvars,
  type ImportEnvironmentVariablesParams,
  // Configure & Auth
  configure,
  auth,
  // Context
  type Context,
} from '@trigger.dev/sdk/v3';

// Note: The trigger.config.ts at package root is used by the Trigger.dev CLI.
// It should not be imported at runtime - it's a configuration file for the CLI.

// Export security-monitor task
export { securityMonitorTask, SECURITY_MONITOR_TASK_ID } from '../cron/security-monitor.js';
export type { SecurityMonitorInput, SecurityMonitorPayload, Vulnerability, SecurityScanResult } from '../cron/security-monitor.js';

// Export bug-scanner task
export { bugScannerTask, BUG_SCANNER_TASK_ID } from '../cron/bug-scanner.js';
export type { BugScannerInput, BugScannerPayload, BugFinding, BugScanResult } from '../cron/bug-scanner.js';

// Environment variable getters
/**
 * Get the Trigger.dev project ID from environment variables.
 * Throws if TRIGGER_PROJECT_ID is not set.
 */
export function getTriggerProjectId(): string {
  const projectId = process.env.TRIGGER_PROJECT_ID;
  if (!projectId) {
    throw new Error('TRIGGER_PROJECT_ID environment variable is required');
  }
  return projectId;
}

/**
 * Get the Trigger.dev secret key from environment variables.
 * Returns undefined if not set (useful for dev mode).
 */
export function getTriggerSecretKey(): string | undefined {
  return process.env.TRIGGER_SECRET_KEY;
}

/**
 * Check if Trigger.dev is configured (has both project ID and secret key)
 */
export function isTriggerConfigured(): boolean {
  return !!(process.env.TRIGGER_PROJECT_ID && process.env.TRIGGER_SECRET_KEY);
}
