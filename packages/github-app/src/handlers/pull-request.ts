import type { App } from "@octokit/app";
import { db } from "@codowave/core/db";
import { runs } from "@codowave/core/db/schema";
import { eq } from "drizzle-orm";

/**
 * Extracts the issue number from a branch name.
 *
 * Supports naming conventions:
 *   - codowave/issue-{N}[-...]
 *   - agent/issue-{N}[-...]
 *   - feat/...-{N}  (only if the number appears after a hyphen at the end)
 *
 * Returns null if no issue number can be determined.
 */
function extractIssueNumber(branchName: string): number | null {
  // Primary patterns used by the Codowave agent
  const primaryMatch = branchName.match(
    /(?:codowave\/issue-|agent\/issue-)(\d+)/
  );
  if (primaryMatch) return parseInt(primaryMatch[1], 10);

  // Fallback: feat/some-slug-{N} where N is at the end
  const fallbackMatch = branchName.match(/-(\d+)$/);
  if (fallbackMatch) return parseInt(fallbackMatch[1], 10);

  return null;
}

export function registerPullRequestHandlers(app: App) {
  // PR opened — record PR info and mark run as awaiting_merge
  app.webhooks.on("pull_request.opened", async ({ payload }) => {
    const pr = payload.pull_request;
    const branchName = pr.head.ref;
    const issueNumber = extractIssueNumber(branchName);

    if (issueNumber === null) {
      console.log(
        `[pull_request.opened] pr=#${pr.number} branch=${branchName} — no issue number, skipping`
      );
      return;
    }

    console.log(
      `[pull_request.opened] pr=#${pr.number} branch=${branchName} issue=#${issueNumber}`
    );

    await db
      .update(runs)
      .set({
        prNumber: pr.number,
        prUrl: pr.html_url,
        status: "awaiting_merge",
        updatedAt: new Date(),
      })
      .where(eq(runs.issueNumber, issueNumber));
  });

  // PR closed — only act if it was merged
  app.webhooks.on("pull_request.closed", async ({ payload }) => {
    const pr = payload.pull_request;
    const branchName = pr.head.ref;
    const issueNumber = extractIssueNumber(branchName);

    if (issueNumber === null) return;

    if (!pr.merged) {
      // PR closed without merge — mark as failed so the agent can retry
      console.log(
        `[pull_request.closed/unmerged] pr=#${pr.number} issue=#${issueNumber}`
      );
      await db
        .update(runs)
        .set({
          status: "failed",
          updatedAt: new Date(),
        })
        .where(eq(runs.issueNumber, issueNumber));
      return;
    }

    console.log(
      `[pull_request.closed/merged] pr=#${pr.number} issue=#${issueNumber}`
    );

    await db
      .update(runs)
      .set({
        status: "merged",
        updatedAt: new Date(),
      })
      .where(eq(runs.issueNumber, issueNumber));
  });

  // PR reopened — reset to awaiting_merge
  app.webhooks.on("pull_request.reopened", async ({ payload }) => {
    const pr = payload.pull_request;
    const branchName = pr.head.ref;
    const issueNumber = extractIssueNumber(branchName);

    if (issueNumber === null) return;

    console.log(
      `[pull_request.reopened] pr=#${pr.number} issue=#${issueNumber}`
    );

    await db
      .update(runs)
      .set({
        status: "awaiting_merge",
        updatedAt: new Date(),
      })
      .where(eq(runs.issueNumber, issueNumber));
  });

  // PR synchronize — new commits pushed to the branch
  app.webhooks.on("pull_request.synchronize", async ({ payload }) => {
    const pr = payload.pull_request;
    console.log(
      `[pull_request.synchronize] pr=#${pr.number} sha=${pr.head.sha}`
    );
    // No DB action needed; the run stays in awaiting_merge
    // PRMerger will re-poll CI status after the new commit
  });

  // Check run completed — CI result for a PR
  app.webhooks.on("check_run.completed", async ({ payload }) => {
    const checkRun = payload.check_run;
    const conclusion = checkRun.conclusion ?? "unknown";
    console.log(
      `[check_run.completed] name=${checkRun.name} conclusion=${conclusion}`
    );
    // PRMerger polls check status directly via Octokit; no DB update needed here
  });
}
