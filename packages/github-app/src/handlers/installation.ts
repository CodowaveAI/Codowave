import type { App } from "@octokit/app";
import { db } from "@codowave/core/db";
import { installations, repositories } from "@codowave/core/db/schema";
import { eq } from "drizzle-orm";

export function registerInstallationHandlers(app: App) {
  // New installation
  app.webhooks.on("installation.created", async ({ payload }) => {
    console.log(`[installation] created installationId=${payload.installation.id}`);

    await db
      .insert(installations)
      .values({
        githubInstallationId: payload.installation.id,
        accountId: payload.installation.account.id,
        accountLogin: payload.installation.account.login,
        accountType: payload.installation.account.type,
        appId: payload.installation.app_id,
        targetId: payload.installation.target_id,
        targetType: payload.installation.target_type,
        permissions: payload.installation.permissions,
        events: payload.installation.events,
        status: "active",
      })
      .onConflictDoUpdate({
        target: installations.githubInstallationId,
        set: { status: "active", updatedAt: new Date() },
      });

    // Sync repos from the installation
    if (payload.repositories) {
      for (const repo of payload.repositories) {
        await db
          .insert(repositories)
          .values({
            installationId: payload.installation.id,
            githubRepoId: repo.id,
            name: repo.name,
            fullName: repo.full_name,
            private: repo.private,
            defaultBranch: "main",
          })
          .onConflictDoNothing();
      }
    }
  });

  // Installation deleted
  app.webhooks.on("installation.deleted", async ({ payload }) => {
    console.log(`[installation] deleted installationId=${payload.installation.id}`);
    await db
      .update(installations)
      .set({ status: "suspended", updatedAt: new Date() })
      .where(eq(installations.githubInstallationId, payload.installation.id));
  });

  // Repos added/removed
  app.webhooks.on("installation_repositories.added", async ({ payload }) => {
    for (const repo of payload.repositories_added) {
      await db
        .insert(repositories)
        .values({
          installationId: payload.installation.id,
          githubRepoId: repo.id,
          name: repo.name,
          fullName: repo.full_name,
          private: repo.private,
          defaultBranch: "main",
        })
        .onConflictDoNothing();
    }
  });

  app.webhooks.on("installation_repositories.removed", async ({ payload }) => {
    for (const repo of payload.repositories_removed) {
      await db
        .update(repositories)
        .set({ active: false, updatedAt: new Date() })
        .where(eq(repositories.githubRepoId, repo.id));
    }
  });
}
