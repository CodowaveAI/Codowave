import type { App } from "@octokit/app";
import { db } from "@codowave/core/db";
import { runs } from "@codowave/core/db/schema";
import { eq } from "drizzle-orm";

export function registerPullRequestHandlers(app: App) {
  // PR opened — update run with PR info
  app.webhooks.on("pull_request.opened", async ({ payload }) => {
    const pr = payload.pull_request;
    const branchName = pr.head.ref;

    // Match run by branch name pattern: codowave/issue-{N}-*
    const match = branchName.match(/^codowave\/issue-(\d+)-/);
    if (!match) return;

    const issueNumber = parseInt(match[1], 10);

    console.log(`[pull_request.opened] pr=#${pr.number} branch=${branchName}`);

    await db
      .update(runs)
      .set({
        prNumber: pr.number,
        prUrl: pr.html_url,
        status: "awaiting_merge",
        updatedAt: new Date(),
      })
      .where(
        eq(runs.issueNumber, issueNumber)
        // In production, also filter by repositoryId
      );
  });

  // PR merged
  app.webhooks.on("pull_request.closed", async ({ payload }) => {
    const pr = payload.pull_request;
    if (!pr.merged) return;

    const branchName = pr.head.ref;
    const match = branchName.match(/^codowave\/issue-(\d+)-/);
    if (!match) return;

    const issueNumber = parseInt(match[1], 10);

    console.log(`[pull_request.closed/merged] pr=#${pr.number}`);

    await db
      .update(runs)
      .set({
        status: "merged",
        updatedAt: new Date(),
      })
      .where(eq(runs.issueNumber, issueNumber));
  });

  // Check suite / CI completed
  app.webhooks.on("check_run.completed", async ({ payload }) => {
    const checkRun = payload.check_run;
    console.log(
      `[check_run.completed] name=${checkRun.name} conclusion=${checkRun.conclusion}`
    );
    // The PRMerger polls for this via Octokit directly; no DB action needed here
  });
}
