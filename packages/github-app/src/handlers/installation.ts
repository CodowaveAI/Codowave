import type { App } from "@octokit/app";

/**
 * Registers installation event handlers.
 *
 * OSS note: DB persistence is intentionally omitted. In the hosted version,
 * these handlers sync to the `installations` and `repositories` tables.
 * Implementors can extend this with their own persistence layer.
 */
export function registerInstallationHandlers(app: App): void {
  app.webhooks.on("installation.created", async ({ payload }) => {
    console.log(
      `[installation.created] installationId=${payload.installation.id} account=${payload.installation.account?.login ?? "unknown"}`
    );
    // TODO (hosted): sync to installations + repositories tables
  });

  app.webhooks.on("installation.deleted", async ({ payload }) => {
    console.log(
      `[installation.deleted] installationId=${payload.installation.id}`
    );
    // TODO (hosted): mark installation suspended in DB
  });

  app.webhooks.on("installation_repositories.added", async ({ payload }) => {
    for (const repo of payload.repositories_added) {
      console.log(
        `[installation_repositories.added] repo=${repo.full_name} installationId=${payload.installation.id}`
      );
      // TODO (hosted): insert into repositories table
    }
  });

  app.webhooks.on("installation_repositories.removed", async ({ payload }) => {
    for (const repo of payload.repositories_removed) {
      console.log(
        `[installation_repositories.removed] repo=${repo.full_name}`
      );
      // TODO (hosted): mark repository inactive in DB
    }
  });
}
