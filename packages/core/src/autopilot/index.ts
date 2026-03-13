/**
 * AutopilotRunner — OSS Edition
 *
 * Orchestrates the full Codowave pipeline in autopilot mode:
 *   1. Select the best available issue via priority scoring
 *   2. Build context + generate plan (no approval gate)
 *   3. Apply code patch
 *   4. Wait for CI checks to pass
 *   5. Auto-merge if all checks succeed
 *
 * No DB dependencies in OSS mode — state is tracked in-memory and via
 * GitHub labels/PR status.
 */

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  /** ISO-8601 timestamp when the issue was created */
  createdAt: string;
  /** Number of comments on the issue */
  comments: number;
  /** Whether the issue is currently assigned to someone */
  assignee: string | null;
}

export interface IssueScore {
  issue: GitHubIssue;
  /** Higher score = higher priority */
  score: number;
  /** Human-readable breakdown of scoring factors */
  breakdown: string[];
}

export interface AutopilotConfig {
  /** GitHub owner (org or user) */
  owner: string;
  /** GitHub repository name */
  repo: string;
  /** Label to use as the trigger signal (e.g. "agent-ready") */
  triggerLabel: string;
  /** Merge strategy when auto-merging (default: "squash") */
  mergeStrategy?: 'squash' | 'merge' | 'rebase';
  /** How long to poll CI before giving up (default: 30 minutes) */
  ciTimeoutMs?: number;
  /** How often to poll CI checks (default: 30 seconds) */
  ciPollIntervalMs?: number;
}

export interface CICheckRun {
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: string | null;
}

export interface AutopilotMergeResult {
  merged: boolean;
  reason: string;
  sha?: string;
}

/**
 * Scores a list of GitHub issues for autopilot priority selection.
 *
 * Scoring factors (higher = more urgent):
 * - +50  Has the trigger label (e.g. "agent-ready")
 * - +20  Has "priority" or "urgent" label
 * - +10  Has "bug" label
 * -  5   Is assigned to someone (deprioritise — human is likely handling it)
 * +  1 per comment (community demand signal, capped at +20)
 * +  1 per 7 days old (up to +30, so ~7 months caps age bonus)
 *
 * Returns issues sorted descending by score.
 */
export function scoreIssues(
  issues: GitHubIssue[],
  triggerLabel: string,
): IssueScore[] {
  const now = Date.now();

  const scored = issues.map((issue): IssueScore => {
    const breakdown: string[] = [];
    let score = 0;

    // Trigger label presence
    if (issue.labels.includes(triggerLabel)) {
      score += 50;
      breakdown.push(`+50 has trigger label "${triggerLabel}"`);
    }

    // Priority / urgency signals
    if (
      issue.labels.some((l) =>
        ['priority', 'urgent', 'critical', 'p0', 'p1'].includes(l.toLowerCase()),
      )
    ) {
      score += 20;
      breakdown.push('+20 priority/urgent label');
    }

    // Bug signal
    if (issue.labels.some((l) => l.toLowerCase() === 'bug')) {
      score += 10;
      breakdown.push('+10 bug label');
    }

    // Assignee penalty — someone is already on it
    if (issue.assignee !== null) {
      score -= 5;
      breakdown.push('-5 already assigned');
    }

    // Community demand: comments (capped at +20)
    const commentBonus = Math.min(issue.comments, 20);
    if (commentBonus > 0) {
      score += commentBonus;
      breakdown.push(`+${commentBonus} comment bonus (${issue.comments} comments, capped at 20)`);
    }

    // Age signal: +1 per 7 days, capped at +30
    const ageMs = now - new Date(issue.createdAt).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    const ageBonus = Math.min(Math.floor(ageDays / 7), 30);
    if (ageBonus > 0) {
      score += ageBonus;
      breakdown.push(`+${ageBonus} age bonus (${Math.floor(ageDays)} days old, capped at 30)`);
    }

    return { issue, score, breakdown };
  });

  // Sort descending by score; break ties by issue number (oldest first)
  return scored.sort((a, b) =>
    b.score !== a.score ? b.score - a.score : a.issue.number - b.issue.number,
  );
}

/**
 * Returns the highest-priority issue, or null if there are none.
 */
export function selectBestIssue(
  issues: GitHubIssue[],
  triggerLabel: string,
): GitHubIssue | null {
  const scored = scoreIssues(issues, triggerLabel);
  return scored[0]?.issue ?? null;
}

// ─── Octokit interface (minimal surface needed by AutopilotRunner) ─────────

interface OctokitChecks {
  listForRef(params: {
    owner: string;
    repo: string;
    ref: string;
    per_page?: number;
  }): Promise<{ data: { check_runs: Array<{ name: string; status: string; conclusion: string | null }> } }>;
}

interface OctokitPulls {
  get(params: {
    owner: string;
    repo: string;
    pull_number: number;
  }): Promise<{ data: { state: string; merged: boolean; draft: boolean; head: { sha: string }; title: string } }>;
  merge(params: {
    owner: string;
    repo: string;
    pull_number: number;
    merge_method: 'squash' | 'merge' | 'rebase';
    commit_title?: string;
    commit_message?: string;
  }): Promise<{ data: { merged: boolean; sha: string; message: string } }>;
}

export interface AutopilotOctokit {
  checks: OctokitChecks;
  pulls: OctokitPulls;
}

// ─── AutopilotRunner ────────────────────────────────────────────────────────

/**
 * AutopilotRunner manages CI polling and auto-merge for a single PR.
 *
 * Usage:
 * ```typescript
 * const runner = new AutopilotRunner(octokit, {
 *   owner: 'my-org',
 *   repo: 'my-repo',
 *   triggerLabel: 'agent-ready',
 * });
 *
 * const result = await runner.waitAndMerge(prNumber, headSha);
 * ```
 */
export class AutopilotRunner {
  private readonly config: Required<AutopilotConfig>;

  constructor(
    private readonly octokit: AutopilotOctokit,
    config: AutopilotConfig,
  ) {
    this.config = {
      mergeStrategy: 'squash',
      ciTimeoutMs: 30 * 60 * 1_000, // 30 minutes
      ciPollIntervalMs: 30_000,       // 30 seconds
      ...config,
    };
  }

  /**
   * Polls CI check runs for the given head commit until all pass or timeout.
   * If all checks pass, auto-merges the PR.
   *
   * Safety guarantees:
   * - Never merges if any check conclusion is "failure", "cancelled", "timed_out", or "action_required"
   * - Never merges a draft PR
   * - Skips merge if PR is already closed/merged
   */
  async waitAndMerge(
    pullNumber: number,
    headSha: string,
  ): Promise<AutopilotMergeResult> {
    const { owner, repo, ciTimeoutMs, ciPollIntervalMs } = this.config;

    console.log(
      `[AutopilotRunner] Waiting for CI on PR #${pullNumber} ` +
        `(sha: ${headSha.slice(0, 7)}) in ${owner}/${repo}`,
    );

    const deadline = Date.now() + ciTimeoutMs;

    while (Date.now() < deadline) {
      const checks = await this.getCheckRuns(headSha);

      if (checks.length === 0) {
        // No checks registered yet — wait for them to appear
        console.log(`[AutopilotRunner] No checks yet for ${headSha.slice(0, 7)}, waiting...`);
        await sleep(ciPollIntervalMs);
        continue;
      }

      const pending = checks.filter((c) => c.status !== 'completed');

      if (pending.length > 0) {
        const names = pending.map((c) => c.name).join(', ');
        console.log(
          `[AutopilotRunner] ${pending.length} check(s) still running: ${names}`,
        );
        await sleep(ciPollIntervalMs);
        continue;
      }

      // All checks completed — evaluate conclusions
      const failedConclusions = new Set([
        'failure',
        'cancelled',
        'timed_out',
        'action_required',
      ]);

      const failed = checks.filter(
        (c) => c.conclusion !== null && failedConclusions.has(c.conclusion),
      );

      if (failed.length > 0) {
        const names = failed.map((c) => `${c.name} (${c.conclusion})`).join(', ');
        console.warn(`[AutopilotRunner] CI failed for PR #${pullNumber}: ${names}`);
        return { merged: false, reason: `CI checks failed: ${names}` };
      }

      // All passed (success / neutral / skipped) — proceed to merge
      console.log(`[AutopilotRunner] All CI checks passed for PR #${pullNumber}`);
      return await this.attemptMerge(pullNumber);
    }

    return {
      merged: false,
      reason: `CI polling timed out after ${ciTimeoutMs / 60_000} minutes`,
    };
  }

  /**
   * Fetches the current check runs for a given commit SHA.
   */
  async getCheckRuns(headSha: string): Promise<CICheckRun[]> {
    const { owner, repo } = this.config;
    const { data } = await this.octokit.checks.listForRef({
      owner,
      repo,
      ref: headSha,
      per_page: 100,
    });

    return data.check_runs.map((run) => ({
      name: run.name,
      status: run.status as CICheckRun['status'],
      conclusion: run.conclusion,
    }));
  }

  /**
   * Merges the PR after verifying it is still open and not a draft.
   */
  private async attemptMerge(pullNumber: number): Promise<AutopilotMergeResult> {
    const { owner, repo, mergeStrategy } = this.config;

    // Re-fetch PR state before merging (may have been closed/merged externally)
    const { data: pr } = await this.octokit.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
    });

    if (pr.state === 'closed') {
      return {
        merged: pr.merged,
        reason: pr.merged
          ? 'PR was already merged externally'
          : 'PR was closed without merging',
      };
    }

    if (pr.draft) {
      return { merged: false, reason: 'PR is still a draft — skipping auto-merge' };
    }

    try {
      const { data: result } = await this.octokit.pulls.merge({
        owner,
        repo,
        pull_number: pullNumber,
        merge_method: mergeStrategy,
        commit_title: pr.title,
        commit_message: `Auto-merged by Codowave after all CI checks passed.`,
      });

      console.log(
        `[AutopilotRunner] ✅ PR #${pullNumber} merged (sha: ${result.sha.slice(0, 7)})`,
      );

      return {
        merged: result.merged,
        sha: result.sha,
        reason: result.message || 'Merged successfully',
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[AutopilotRunner] Merge failed for PR #${pullNumber}: ${message}`);
      return { merged: false, reason: `Merge API call failed: ${message}` };
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
