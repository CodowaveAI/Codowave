import type { App } from "@octokit/app";
import { db } from "@codowave/core/db";
import { runs, repositories } from "@codowave/core/db/schema";
import { eq, and } from "drizzle-orm";
import { tasks } from "@trigger.dev/sdk/v3";

const TRIGGER_LABEL = "agent-ready";

export function registerIssueHandlers(app: App) {
  app.webhooks.on("issues.labeled", async ({ payload, octokit }) => {
    const label = payload.label?.name;
    if (label !== TRIGGER_LABEL) return;

    const issue = payload.issue;
    const repo = payload.repository;

    console.log(`[issues.labeled] repo=${repo.full_name} issue=#${issue.number} label=${label}`);

    // Find the repository record
    const [repoRecord] = await db
      .select()
      .from(repositories)
      .where(eq(repositories.githubRepoId, repo.id))
      .limit(1);

    if (!repoRecord) {
      console.warn(`[issues.labeled] No repository record found for githubRepoId=${repo.id}`);
      return;
    }

    // Check if a run already exists for this issue
    const [existingRun] = await db
      .select()
      .from(runs)
      .where(
        and(
          eq(runs.repositoryId, repoRecord.id),
          eq(runs.issueNumber, issue.number),
          eq(runs.status, "pending")
        )
      )
      .limit(1);

    if (existingRun) {
      console.log(`[issues.labeled] Run already exists: runId=${existingRun.id}`);
      return;
    }

    // Create a new run record
    const [newRun] = await db
      .insert(runs)
      .values({
        repositoryId: repoRecord.id,
        issueNumber: issue.number,
        issueTitle: issue.title,
        issueBody: issue.body ?? "",
        issueUrl: issue.html_url,
        status: "pending",
        retryCount: 0,
        plan: null,
        patch: null,
        prNumber: null,
        prUrl: null,
      })
      .returning();

    console.log(`[issues.labeled] Created run runId=${newRun.id}`);

    // Add in-progress label to the issue
    await octokit.rest.issues.addLabels({
      owner: repo.owner.login,
      repo: repo.name,
      issue_number: issue.number,
      labels: ["in-progress"],
    });

    // Remove agent-ready label
    await octokit.rest.issues.removeLabel({
      owner: repo.owner.login,
      repo: repo.name,
      issue_number: issue.number,
      name: TRIGGER_LABEL,
    }).catch(() => {/* label may not exist */});

    // Enqueue Trigger.dev task
    await tasks.trigger("process-issue", { runId: newRun.id });

    console.log(`[issues.labeled] Triggered process-issue task for runId=${newRun.id}`);
  });

  app.webhooks.on("issues.unlabeled", async ({ payload }) => {
    // If in-progress label removed manually, we may want to cancel the run
    // For now, just log
    console.log(`[issues.unlabeled] issue=#${payload.issue.number} label=${payload.label?.name}`);
  });
}
