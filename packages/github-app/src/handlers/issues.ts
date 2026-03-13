import type { App } from "@octokit/app";

const AGENT_READY_LABEL = "agent-ready";
const IN_PROGRESS_LABEL = "in-progress";

/**
 * Registers issue event handlers.
 *
 * OSS note: Trigger.dev and DB integration are omitted.
 * When an issue is labeled `agent-ready`, a custom event is emitted
 * that downstream consumers can subscribe to via the `onIssueReady` hook.
 */

type IssueReadyPayload = {
  owner: string;
  repo: string;
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  issueUrl: string;
  installationId: number;
};

type IssueReadyHandler = (payload: IssueReadyPayload) => Promise<void>;

const handlers: IssueReadyHandler[] = [];

/** Register a callback that fires when an issue is labeled agent-ready. */
export function onIssueReady(handler: IssueReadyHandler): void {
  handlers.push(handler);
}

export function registerIssueHandlers(app: App): void {
  app.webhooks.on("issues.labeled", async ({ payload, octokit }) => {
    const label = payload.label?.name;
    if (label !== AGENT_READY_LABEL) return;

    const issue = payload.issue;
    const repo = payload.repository;

    console.log(
      `[issues.labeled] repo=${repo.full_name} issue=#${issue.number} label=${label}`
    );

    // Fail fast if installation context is missing — cannot authenticate without it
    if (!payload.installation?.id) {
      console.error("[issues.labeled] Missing installation.id — cannot dispatch onIssueReady");
      return;
    }

    // Update labels: add in-progress, remove agent-ready
    await octokit.rest.issues
      .addLabels({
        owner: repo.owner.login,
        repo: repo.name,
        issue_number: issue.number,
        labels: [IN_PROGRESS_LABEL],
      })
      .catch((err: unknown) =>
        console.error("[issues.labeled] Failed to add in-progress label:", err)
      );

    await octokit.rest.issues
      .removeLabel({
        owner: repo.owner.login,
        repo: repo.name,
        issue_number: issue.number,
        name: AGENT_READY_LABEL,
      })
      .catch(() => {
        /* label may already be removed */
      });

    // Emit to registered handlers
    const readyPayload: IssueReadyPayload = {
      owner: repo.owner.login,
      repo: repo.name,
      issueNumber: issue.number,
      issueTitle: issue.title,
      issueBody: issue.body ?? "",
      issueUrl: issue.html_url,
      installationId: payload.installation.id,
    };

    for (const handler of handlers) {
      await handler(readyPayload).catch((err: unknown) =>
        console.error("[issues.labeled] Handler error:", err)
      );
    }
  });

  app.webhooks.on("issues.unlabeled", async ({ payload }) => {
    console.log(
      `[issues.unlabeled] issue=#${payload.issue.number} label=${payload.label?.name ?? "unknown"}`
    );
  });
}
