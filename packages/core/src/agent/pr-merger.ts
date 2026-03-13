import type { Repository } from './test-runner.js';

export type MergeStrategy = 'merge' | 'squash' | 'rebase';

export interface MergePROptions {
  octokit: OctokitForMerge;
  repo: Repository;
  prNumber: number;
  /** Optional run ID for logging / traceability */
  runId?: string;
  /** Merge strategy to use (default: squash) */
  strategy?: MergeStrategy;
  /** If true, merge immediately after CI passes without waiting for approval */
  autopilot?: boolean;
  /** Maximum wait time in ms (default: 30 minutes) */
  maxWaitMs?: number;
}

export interface MergeResult {
  merged: boolean;
  sha?: string;
  message?: string;
}

interface CheckSuite {
  status: string;
  conclusion: string | null;
}

interface PullRequest {
  state: string;
  merged: boolean;
  head: { sha: string };
  title: string;
}

interface MergeResponse {
  merged: boolean;
  sha: string;
  message: string;
}

interface OctokitForMerge {
  rest: {
    checks: {
      listSuitesForRef(params: {
        owner: string;
        repo: string;
        ref: string;
      }): Promise<{ data: { check_suites: CheckSuite[] } }>;
    };
    pulls: {
      get(params: {
        owner: string;
        repo: string;
        pull_number: number;
      }): Promise<{ data: PullRequest }>;
      merge(params: {
        owner: string;
        repo: string;
        pull_number: number;
        merge_method: MergeStrategy;
        commit_title?: string;
        commit_message?: string;
      }): Promise<{ data: MergeResponse }>;
    };
  };
}

const POLL_INTERVAL_MS = 15_000; // 15 seconds
const DEFAULT_MAX_WAIT_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Checks whether all required CI check suites have completed successfully
 * for the head commit of a PR.
 *
 * Returns true if:
 * - No check suites exist (no CI configured)
 * - All suites have completed with success/neutral/skipped conclusion
 */
async function allChecksPass(
  octokit: OctokitForMerge,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<boolean> {
  const { data: pr } = await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber });
  const headSha = pr.head.sha;

  const { data: suitesData } = await octokit.rest.checks.listSuitesForRef({
    owner,
    repo,
    ref: headSha,
  });

  const suites = suitesData.check_suites;

  if (suites.length === 0) {
    // No CI configured — safe to proceed
    return true;
  }

  const allComplete = suites.every((s) => s.status === 'completed');
  if (!allComplete) return false;

  const passingConclusions = new Set(['success', 'neutral', 'skipped']);
  return suites.every((s) => s.conclusion !== null && passingConclusions.has(s.conclusion));
}

/**
 * Waits for CI checks to pass on a PR, then merges it.
 *
 * In autopilot mode (`options.autopilot = true`), merges automatically once CI passes.
 * In safe mode (default), the caller is responsible for gating the merge —
 * this function still polls CI but will only merge if explicitly instructed.
 *
 * @throws If CI doesn't pass within maxWaitMs, or if the merge API call fails
 */
export async function mergePR(options: MergePROptions): Promise<MergeResult> {
  const {
    octokit,
    repo,
    prNumber,
    runId = 'unknown',
    strategy = 'squash',
    autopilot = false,
    maxWaitMs = DEFAULT_MAX_WAIT_MS,
  } = options;

  const parts = repo.fullName.split('/');
  const owner = parts[0];
  const repoName = parts[1];

  if (!owner || !repoName) {
    throw new Error(`Invalid repo fullName: ${repo.fullName}`);
  }

  console.log(
    `[pr-merger] Waiting for CI on PR #${prNumber} in ${repo.fullName} (run=${runId}, autopilot=${autopilot})`,
  );

  // In non-autopilot mode, we do not merge automatically
  if (!autopilot) {
    console.log(`[pr-merger] Safe mode: CI checks will be verified but merge requires explicit approval`);
    const ciPassed = await allChecksPass(octokit, owner, repoName, prNumber);
    return {
      merged: false,
      message: ciPassed
        ? 'CI passed. Awaiting manual merge approval.'
        : 'CI still running or failed. Awaiting CI + manual merge approval.',
    };
  }

  // Autopilot: poll until CI passes or timeout
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const ciPassed = await allChecksPass(octokit, owner, repoName, prNumber);

    if (ciPassed) {
      console.log(`[pr-merger] CI passed for PR #${prNumber} — proceeding with merge`);
      break;
    }

    console.log(
      `[pr-merger] CI not yet complete for PR #${prNumber}. Retrying in ${POLL_INTERVAL_MS / 1000}s...`,
    );
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  // Final check before merge
  const finalCiPassed = await allChecksPass(octokit, owner, repoName, prNumber);
  if (!finalCiPassed) {
    console.warn(`[pr-merger] CI did not pass within timeout for PR #${prNumber}`);
    return { merged: false, message: 'CI checks did not pass within timeout' };
  }

  // Get current PR state
  const { data: pr } = await octokit.rest.pulls.get({ owner, repo: repoName, pull_number: prNumber });

  if (pr.state === 'closed') {
    return {
      merged: pr.merged,
      message: pr.merged ? 'PR was already merged' : 'PR was closed without merging',
    };
  }

  // Merge
  try {
    const { data: mergeResult } = await octokit.rest.pulls.merge({
      owner,
      repo: repoName,
      pull_number: prNumber,
      merge_method: strategy,
      commit_title: pr.title,
      commit_message: `Merged automatically by Codowave\n\nRun ID: ${runId}`,
    });

    console.log(`[pr-merger] Successfully merged PR #${prNumber} (sha=${mergeResult.sha})`);

    return {
      merged: mergeResult.merged,
      sha: mergeResult.sha,
      message: mergeResult.message,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[pr-merger] Failed to merge PR #${prNumber}: ${message}`);
    throw new Error(`[pr-merger] Failed to merge PR #${prNumber}: ${message}`);
  }
}
