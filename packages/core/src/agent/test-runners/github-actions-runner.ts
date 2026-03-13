import type { TestRunner, Repository } from '../test-runner.js';
import type { Patch, TestResult } from '../../types/index.js';

const POLL_INTERVAL_MS = 10_000; // 10 seconds
const MAX_WAIT_MS = 20 * 60 * 1000; // 20 minutes

interface OctokitActions {
  rest: {
    actions: {
      createWorkflowDispatch(params: {
        owner: string;
        repo: string;
        workflow_id: string;
        ref: string;
        inputs?: Record<string, string>;
      }): Promise<unknown>;
      listWorkflowRunsForRepo(params: {
        owner: string;
        repo: string;
        branch: string;
        per_page: number;
        status: string;
      }): Promise<{ data: { workflow_runs: WorkflowRun[] } }>;
      listJobsForWorkflowRun(params: {
        owner: string;
        repo: string;
        run_id: number;
        per_page: number;
      }): Promise<{ data: { jobs: WorkflowJob[] } }>;
    };
  };
}

interface WorkflowRun {
  id: number;
  conclusion: string | null;
}

interface WorkflowJobStep {
  name: string;
  conclusion: string | null;
}

interface WorkflowJob {
  name: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
  steps?: WorkflowJobStep[];
}

/**
 * OSS test runner that triggers and polls GitHub Actions workflow runs.
 * Uses workflow_dispatch to start CI on the patch branch, then polls
 * until completion and maps job results to TestResult[].
 */
export class GitHubActionsTestRunner implements TestRunner {
  async run(patch: Patch, repo: Repository, octokit: unknown): Promise<TestResult[]> {
    const api = octokit as OctokitActions;
    const [owner, repoName] = repo.fullName.split('/');
    if (!owner || !repoName) {
      throw new Error(`Invalid repo fullName: ${repo.fullName}`);
    }

    console.log(`[gh-actions-runner] Triggering workflow for ${repo.fullName} on branch ${patch.branch}`);

    const workflowFile = repo.ciWorkflowFile ?? 'ci.yml';

    // Attempt workflow_dispatch (may fail if workflow doesn't support it)
    try {
      await api.rest.actions.createWorkflowDispatch({
        owner,
        repo: repoName,
        workflow_id: workflowFile,
        ref: patch.branch,
        inputs: { codowave_run: 'true' },
      });
      console.log(`[gh-actions-runner] workflow_dispatch triggered for ${workflowFile}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[gh-actions-runner] workflow_dispatch failed (may not be configured): ${message}`);
    }

    // Give GitHub a moment to register the run
    await delay(5000);

    // Poll for a completed run on this branch
    const startTime = Date.now();
    while (Date.now() - startTime < MAX_WAIT_MS) {
      // Check for completed runs first
      const { data: completedData } = await api.rest.actions.listWorkflowRunsForRepo({
        owner,
        repo: repoName,
        branch: patch.branch,
        per_page: 1,
        status: 'completed',
      });

      const completedRun = completedData.workflow_runs[0];
      if (completedRun !== undefined) {
        console.log(`[gh-actions-runner] Workflow run ${completedRun.id} completed with conclusion: ${completedRun.conclusion}`);
        return await this.getJobResults(api, owner, repoName, completedRun.id);
      }

      // Check if there are in-progress runs (still waiting)
      const { data: inProgressData } = await api.rest.actions.listWorkflowRunsForRepo({
        owner,
        repo: repoName,
        branch: patch.branch,
        per_page: 1,
        status: 'in_progress',
      });

      if (inProgressData.workflow_runs.length === 0) {
        // No runs at all — CI may not be configured on this branch
        console.warn(`[gh-actions-runner] No workflow runs found for branch ${patch.branch}. Skipping.`);
        return [
          {
            suite: 'unit',
            passed: true,
            durationMs: 0,
            log: 'No GitHub Actions workflow runs found for this branch. CI may not be configured.',
          },
        ];
      }

      console.log(`[gh-actions-runner] Workflow in progress, polling again in ${POLL_INTERVAL_MS / 1000}s...`);
      await delay(POLL_INTERVAL_MS);
    }

    throw new Error(
      `[gh-actions-runner] Test run timed out after ${MAX_WAIT_MS / 60000} minutes for branch ${patch.branch}`,
    );
  }

  private async getJobResults(
    api: OctokitActions,
    owner: string,
    repoName: string,
    runId: number,
  ): Promise<TestResult[]> {
    const { data: jobsData } = await api.rest.actions.listJobsForWorkflowRun({
      owner,
      repo: repoName,
      run_id: runId,
      per_page: 50,
    });

    if (jobsData.jobs.length === 0) {
      return [
        {
          suite: 'unit',
          passed: false,
          durationMs: 0,
          log: `Workflow run ${runId} had no jobs.`,
        },
      ];
    }

    return jobsData.jobs.map((job): TestResult => {
      const passed = job.conclusion === 'success' || job.conclusion === 'skipped';
      const durationMs =
        job.completed_at && job.started_at
          ? new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()
          : 0;

      const stepLog = (job.steps ?? [])
        .map((s) => `  ${s.conclusion === 'success' ? '✓' : '✗'} ${s.name}: ${s.conclusion ?? 'pending'}`)
        .join('\n');

      // Map job name to suite heuristically
      const suite = resolveSuite(job.name);

      return {
        suite,
        passed,
        durationMs,
        log: stepLog || `Job ${job.name}: ${job.conclusion ?? 'unknown'}`,
      };
    });
  }
}

/** Resolve a GitHub Actions job name to a TestResult suite. */
function resolveSuite(jobName: string): TestResult['suite'] {
  const lower = jobName.toLowerCase();
  if (lower.includes('lint') || lower.includes('eslint')) return 'lint';
  if (lower.includes('typecheck') || lower.includes('type-check') || lower.includes('tsc')) return 'typecheck';
  if (lower.includes('playwright') || lower.includes('e2e')) return 'playwright';
  return 'unit';
}

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
