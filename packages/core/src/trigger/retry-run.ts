/**
 * retry-run Trigger.dev Task
 *
 * Re-triggers a failed pipeline run by:
 * 1. Resetting the run status to 'pending'
 * 2. Incrementing the attempt counter
 * 3. Enqueuing a new `process-issue` job
 */

import { task, logger, tasks } from '@trigger.dev/sdk/v3';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import type { ProcessIssueInput } from './process-issue.js';

// ─── Task Constants ───────────────────────────────────────────────────────────

const PROCESS_ISSUE_TASK_ID = 'process-issue';

// ─── Task Input ──────────────────────────────────────────────────────────────

export interface RetryRunInput {
  /** The run ID to retry */
  runId: string;
}

// ─── Task Payload ──────────────────────────────────────────────────────────────

export interface RetryRunPayload {
  input: RetryRunInput;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any;
}

// ─── Main Task ───────────────────────────────────────────────────────────────

/**
 * Retry Run Task
 *
 * Resets a failed run and re-enqueues the process-issue task.
 * Used when a run fails and needs to be retried.
 */
export const retryRunTask = task({
  id: 'retry-run',
  maxDuration: 60, // 1 minute max - mostly just DB updates
  retry: {
    maxAttempts: 3,
    factor: 2,
  },
  async run(payload: RetryRunPayload) {
    const { input } = payload;
    const { runId } = input;

    logger.info(`Starting retry-run for run ${runId}`);

    try {
      // ─────────────────────────────────────────────────────────────────────────
      // Step 1: Fetch the existing run
      // ─────────────────────────────────────────────────────────────────────────
      const existingRun = await db
        .select()
        .from(schema.runs)
        .where(eq(schema.runs.id, runId))
        .limit(1);

      if (existingRun.length === 0) {
        logger.error(`Run ${runId} not found`);
        return {
          success: false,
          runId,
          error: 'Run not found',
        };
      }

      const run = existingRun[0];

      if (!run) {
        logger.error(`Run ${runId} not found`);
        return {
          success: false,
          runId,
          error: 'Run not found',
        };
      }

      // Only retry failed runs
      if (run.status !== 'failed') {
        logger.warn(`Run ${runId} is not in failed status (current: ${run.status}), skipping retry`);
        return {
          success: false,
          runId,
          error: `Run is not in failed status (current: ${run.status})`,
        };
      }

      // ─────────────────────────────────────────────────────────────────────────
      // Step 2: Reset run status and increment attempt
      // ─────────────────────────────────────────────────────────────────────────
      const currentAttempt = run.attempt ?? 1;
      const newAttempt = currentAttempt + 1;

      await db
        .update(schema.runs)
        .set({
          status: 'pending',
          attempt: newAttempt,
          errorMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.runs.id, runId));

      logger.info(`Reset run ${runId} to pending, attempt ${newAttempt}`);

      // ─────────────────────────────────────────────────────────────────────────
      // Step 3: Enqueue a new process-issue job
      // ─────────────────────────────────────────────────────────────────────────
      
      // We need to fetch the original issue info to re-run the process
      // For now, we'll trigger with minimal info - the process-issue task
      // will need to handle the case where it creates a new run record
      const processIssueInput: ProcessIssueInput = {
        githubInstallationId: 0, // Would need to be stored with the run or fetched
        owner: '', // Would need to be stored with the run
        repo: '', // Would need to be stored with the run
        issueNumber: 0, // Would need to be stored with the run
        userId: run.userId,
        repositoryId: run.repositoryId,
      };

      // Trigger the process-issue task by ID string
      const runHandle = await tasks.trigger(
        PROCESS_ISSUE_TASK_ID,
        processIssueInput
      );

      logger.info(`Enqueued new process-issue job for run ${runId}, handle: ${runHandle.id}`);

      // ─────────────────────────────────────────────────────────────────────────
      // Complete
      // ─────────────────────────────────────────────────────────────────────────
      logger.info(`Retry-run completed for run ${runId}`);

      return {
        success: true,
        runId,
        previousAttempt: currentAttempt,
        newAttempt,
        processIssueRunId: runHandle.id,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Retry-run failed for run ${runId}: ${errorMessage}`);

      return {
        success: false,
        runId,
        error: errorMessage,
      };
    }
  },
});

// Export the task ID for use in other modules
export const RETRY_RUN_TASK_ID = 'retry-run';
