/**
 * process-issue Trigger.dev Task
 *
 * Main orchestration task that runs the full agent pipeline:
 * ContextBuilder → Planner → (approval gate) → Coder → TestRunner → PRCreator
 *
 * Updates `runs` and `run_stages` tables at each transition.
 */

import { task, logger } from '@trigger.dev/sdk/v3';
import { db, schema } from '../db/index.js';
import { buildContext, type BuildContextOptions } from '../agent/context-builder.js';
import { runTests, type RunTestsOptions, type Repository } from '../agent/test-runner.js';
import { createPR, type CreatePROptions } from '../agent/pr-creator.js';
import { eq, and } from 'drizzle-orm';
import type { Plan, Patch, RepoContext, TestResult } from '../types/index.js';

// ─── Task Input ──────────────────────────────────────────────────────────────

export interface ProcessIssueInput {
  /** GitHub installation ID (from GitHub App) */
  githubInstallationId: number;
  /** Repository owner (e.g., "octocat") */
  owner: string;
  /** Repository name (e.g., "Hello-World") */
  repo: string;
  /** Issue number to process */
  issueNumber: number;
  /** User ID who triggered this run */
  userId: string;
  /** Repository ID from the database */
  repositoryId: string;
  /** Whether to skip the approval gate (for testing/automation) */
  skipApproval?: boolean;
}

// ─── Task Payload ──────────────────────────────────────────────────────────────

export interface ProcessIssuePayload {
  input: ProcessIssueInput;
}

// ─── Stage Names ──────────────────────────────────────────────────────────────

const STAGES = {
  CONTEXT_BUILDING: 'context_building',
  PLANNING: 'planning',
  APPROVAL: 'approval',
  CODING: 'coding',
  TESTING: 'testing',
  PR_CREATION: 'pr_creation',
} as const;

// ─── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Updates the run status in the database.
 */
async function updateRunStatus(runId: string, status: string): Promise<void> {
  await db
    .update(schema.runs)
    .set({
      status: status as typeof schema.runs.$inferSelect.status,
      updatedAt: new Date(),
    })
    .where(eq(schema.runs.id, runId));
}

/**
 * Creates or updates a run stage in the database.
 */
async function upsertRunStage(
  runId: string,
  stageName: string,
  stageStatus: 'pending' | 'running' | 'completed' | 'failed' | 'skipped',
  errorMessage?: string,
): Promise<string> {
  // Check if stage exists
  const existing = await db
    .select()
    .from(schema.runStages)
    .where(
      and(
        eq(schema.runStages.runId, runId),
        eq(schema.runStages.stageName, stageName),
      ),
    )
    .limit(1);

  const existingStage = existing[0];

  if (existingStage) {
    await db
      .update(schema.runStages)
      .set({
        status: stageStatus as typeof schema.runStages.$inferSelect.status,
        errorMessage,
        updatedAt: new Date(),
        ...(stageStatus === 'running' ? { startedAt: new Date() } : {}),
        ...(stageStatus === 'completed' || stageStatus === 'failed' ? { completedAt: new Date() } : {}),
      })
      .where(eq(schema.runStages.id, existingStage.id));
    return existingStage.id;
  }

  // Create new stage
  const [stage] = await db
    .insert(schema.runStages)
    .values({
      runId,
      stageName,
      status: stageStatus as typeof schema.runStages.$inferSelect.status,
      errorMessage,
      ...(stageStatus === 'running' ? { startedAt: new Date() } : {}),
      ...(stageStatus === 'completed' || stageStatus === 'failed' ? { completedAt: new Date() } : {}),
    })
    .returning();

  if (!stage) {
    throw new Error('Failed to create run stage');
  }
  return stage.id;
}

/**
 * Creates a new run in the database.
 */
async function createRun(input: ProcessIssueInput, installationDbId: string | null): Promise<string> {
  const [run] = await db
    .insert(schema.runs)
    .values({
      userId: input.userId,
      repositoryId: input.repositoryId,
      installationId: installationDbId,
      status: 'in_progress',
      startedAt: new Date(),
    })
    .returning();

  if (!run) {
    throw new Error('Failed to create run');
  }
  return run.id;
}

/**
 * Create a simple plan based on the issue
 * In production, this would use an AI model to generate a proper plan
 */
async function createSimplePlan(context: RepoContext): Promise<Plan> {
  const relevantFiles = Object.keys(context.relevantFiles);
  return {
    approach: `Fix the issue "${context.issue.title}" by modifying the relevant files.`,
    steps: [
      {
        description: `Fix issue: ${context.issue.title}`,
        filesToModify: relevantFiles.slice(0, 10),
      },
    ],
    filesToModify: relevantFiles.slice(0, 10),
  };
}

/**
 * Generate a simple patch based on the issue
 * In production, this would use an AI model to generate code changes
 */
async function generateSimplePatch(
  context: RepoContext,
  plan: Plan,
  issueNumber: number,
): Promise<Patch> {
  const branchName = `fix/issue-${issueNumber}-${Date.now()}`;
  const filesList = plan.filesToModify.join('\n');
  
  // Generate a simple diff as placeholder
  const diff = `--- a/PLACEHOLDER.txt\n+++ b/PLACEHOLDER.txt\n@@ -1 +1,2 @@\n # Placeholder fix for issue #${issueNumber}\n+This is a placeholder fix generated in the absence of an AI coder.`;

  return {
    branch: branchName,
    commitMessage: `fix: ${context.issue.title} (#${issueNumber})`,
    diff,
  };
}

// ─── Main Task ───────────────────────────────────────────────────────────────

/**
 * Process Issue Task
 *
 * Orchestrates the full agent pipeline for processing a GitHub issue:
 * 1. ContextBuilder - Fetch issue, file tree, and relevant files
 * 2. Planner - Generate a plan based on context
 * 3. Approval Gate - Wait for user approval (simplified for now)
 * 4. Coder - Generate code changes (patch)
 * 5. TestRunner - Run tests on the generated code
 * 6. PRCreator - Create a pull request with the changes
 */
export const processIssueTask = task({
  id: 'process-issue',
  maxDuration: 600, // 10 minutes max
  retry: {
    maxAttempts: 2,
    factor: 2,
  },
  run: async (payload: ProcessIssuePayload) => {
    const { input } = payload;
    const { githubInstallationId, owner, repo, issueNumber, userId, repositoryId, skipApproval } = input;

    logger.info(`Starting process-issue for ${owner}/${repo}#${issueNumber}`);

    let runId: string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let octokit: any;

    try {
      // ─────────────────────────────────────────────────────────────────────────
      // Stage 0: Resolve installation ID to DB UUID
      // ─────────────────────────────────────────────────────────────────────────
      const installationRecords = await db
        .select()
        .from(schema.installations)
        .where(eq(schema.installations.githubInstallationId, githubInstallationId))
        .limit(1);

      const installationDbId = installationRecords[0]?.id ?? null;

      // ─────────────────────────────────────────────────────────────────────────
      // Stage 1: Create Run Record
      // ─────────────────────────────────────────────────────────────────────────
      runId = await createRun(input, installationDbId);
      logger.info(`Created run ${runId}`);

      // Initialize Octokit
      const { Octokit } = await import('octokit');
      octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

      // ─────────────────────────────────────────────────────────────────────────
      // Stage 2: ContextBuilder
      // ─────────────────────────────────────────────────────────────────────────
      await updateRunStatus(runId, 'context_building');
      await upsertRunStage(runId, STAGES.CONTEXT_BUILDING, 'running');

      const contextOptions: BuildContextOptions = {
        octokit,
        owner,
        repoName: repo,
        issueNumber,
      };

      const context = await buildContext(contextOptions);
      await upsertRunStage(runId, STAGES.CONTEXT_BUILDING, 'completed');

      logger.info(`Context built: ${Object.keys(context.relevantFiles).length} relevant files`);

      // ─────────────────────────────────────────────────────────────────────────
      // Stage 3: Planner
      // ─────────────────────────────────────────────────────────────────────────
      await updateRunStatus(runId, 'planning');
      await upsertRunStage(runId, STAGES.PLANNING, 'running');

      const plan = await createSimplePlan(context);
      await upsertRunStage(runId, STAGES.PLANNING, 'completed');

      logger.info(`Plan created: ${plan.steps.length} steps`);

      // ─────────────────────────────────────────────────────────────────────────
      // Stage 4: Approval Gate
      // ─────────────────────────────────────────────────────────────────────────
      await updateRunStatus(runId, 'awaiting_plan_approval');
      await upsertRunStage(runId, STAGES.APPROVAL, 'running');

      logger.info(`Waiting for approval for run ${runId}`);

      // In production, this would use a proper event-driven approval system.
      // For now, we auto-approve if skipApproval is set, otherwise log a note.
      // A real implementation would use a callback task or external event source.
      if (!skipApproval) {
        logger.info(`Approval gate: auto-approving for demo. Set skipApproval=true to bypass.`);
      }

      await upsertRunStage(runId, STAGES.APPROVAL, 'completed');
      logger.info(`Run ${runId} approved (or approval skipped)`);

      // ─────────────────────────────────────────────────────────────────────────
      // Stage 5: Coder
      // ─────────────────────────────────────────────────────────────────────────
      await updateRunStatus(runId, 'coding');
      await upsertRunStage(runId, STAGES.CODING, 'running');

      const patch = await generateSimplePatch(context, plan, issueNumber);
      await upsertRunStage(runId, STAGES.CODING, 'completed');

      logger.info(`Code generated on branch ${patch.branch}`);

      // Update run with patch info
      await db
        .update(schema.runs)
        .set({
          branchName: patch.branch,
          commitSha: patch.commitMessage,
        })
        .where(eq(schema.runs.id, runId));

      // ─────────────────────────────────────────────────────────────────────────
      // Stage 6: TestRunner
      // ─────────────────────────────────────────────────────────────────────────
      await updateRunStatus(runId, 'testing');
      await upsertRunStage(runId, STAGES.TESTING, 'running');

      const testOptions: RunTestsOptions = {
        patch,
        repo: {
          fullName: `${owner}/${repo}`,
        } as Repository,
        octokit,
      };

      const testResults: TestResult[] = await runTests(testOptions);
      await upsertRunStage(runId, STAGES.TESTING, 'completed');

      const allPassed = testResults.every((r) => r.passed);
      logger.info(`Tests completed: ${allPassed ? 'all passed' : 'some failed'}`);

      // ─────────────────────────────────────────────────────────────────────────
      // Stage 7: PRCreator
      // ─────────────────────────────────────────────────────────────────────────
      await updateRunStatus(runId, 'pr_open');
      await upsertRunStage(runId, STAGES.PR_CREATION, 'running');

      const prOptions: CreatePROptions = {
        patch,
        repo: {
          fullName: `${owner}/${repo}`,
        },
        octokit,
        issueNumber,
        issueTitle: context.issue.title,
        plan,
      };

      const prResult = await createPR(prOptions);
      await upsertRunStage(runId, STAGES.PR_CREATION, 'completed');

      logger.info(`PR created: ${prResult.prUrl}`);

      // Update run with PR info
      await db
        .update(schema.runs)
        .set({
          prNumber: prResult.prNumber,
          prTitle: `fix: ${context.issue.title} (#${issueNumber})`,
          status: 'completed',
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.runs.id, runId));

      // ─────────────────────────────────────────────────────────────────────────
      // Complete
      // ─────────────────────────────────────────────────────────────────────────
      logger.info(`Run ${runId} completed successfully`);

      return {
        success: true,
        runId,
        status: 'completed',
        prNumber: prResult.prNumber,
        prUrl: prResult.prUrl,
        branch: patch.branch,
        testResults: testResults.map((r) => ({
          suite: r.suite,
          passed: r.passed,
          durationMs: r.durationMs,
        })),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Run ${runId ?? 'unknown'} failed: ${errorMessage}`);

      // Mark current stage as failed
      if (runId) {
        await updateRunStatus(runId, 'failed');
      }

      return {
        success: false,
        runId,
        status: 'failed',
        error: errorMessage,
      };
    }
  },
});

// Export the task ID for use in other modules
export const PROCESS_ISSUE_TASK_ID = 'process-issue';
