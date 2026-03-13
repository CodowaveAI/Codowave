import type { App } from "@octokit/app";

/**
 * Registers pull request event handlers.
 *
 * OSS note: DB persistence is intentionally omitted. In the hosted version,
 * these handlers update the `runs` table with PR info.
 */
export function registerPullRequestHandlers(app: App): void {
  app.webhooks.on("pull_request.opened", async ({ payload }) => {
    const pr = payload.pull_request;
    const branchName = pr.head.ref;

    // Match Codowave branch pattern: codowave/issue-{N}-*
    const match = branchName.match(/^codowave\/issue-(\d+)-/u);
    if (!match) return;

    const issueNumber = parseInt(match[1] ?? "0", 10);

    console.log(
      `[pull_request.opened] pr=#${pr.number} issue=#${issueNumber} branch=${branchName}`
    );
    // TODO (hosted): update runs table with prNumber + prUrl, set status='awaiting_merge'
  });

  app.webhooks.on("pull_request.closed", async ({ payload }) => {
    const pr = payload.pull_request;
    if (!pr.merged) return;

    const branchName = pr.head.ref;
    const match = branchName.match(/^codowave\/issue-(\d+)-/u);
    if (!match) return;

    const issueNumber = parseInt(match[1] ?? "0", 10);

    console.log(
      `[pull_request.merged] pr=#${pr.number} issue=#${issueNumber}`
    );
    // TODO (hosted): update runs table status='merged'
  });

  app.webhooks.on("check_run.completed", async ({ payload }) => {
    const checkRun = payload.check_run;
    console.log(
      `[check_run.completed] name=${checkRun.name} conclusion=${checkRun.conclusion ?? "null"}`
    );
    // The PRMerger polls check status via Octokit directly; no DB action needed here
  });
}
