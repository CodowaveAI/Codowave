import { githubApp } from "./app.js";
import { registerInstallationHandlers } from "./handlers/installation.js";
import { registerIssueHandlers } from "./handlers/issues.js";
import { registerPullRequestHandlers } from "./handlers/pull-request.js";
import { verifyWebhookSignature } from "./utils/signature.js";

/**
 * Register all webhook event handlers.
 * Call this once at application startup (e.g., in your server entry point).
 * Keeping registration explicit avoids side-effects at import time,
 * which makes testing cleaner (no handler accumulation across test runs).
 */
export function initWebhookHandlers(): void {
  registerInstallationHandlers(githubApp);
  registerIssueHandlers(githubApp);
  registerPullRequestHandlers(githubApp);
}

// Global error handler for unhandled webhook errors
githubApp.webhooks.onError((error) => {
  console.error("[webhook] Error processing event:", error.message);
});

/**
 * Handles an incoming GitHub webhook request.
 *
 * This function is framework-agnostic — it can be used in:
 * - Next.js App Router route handlers
 * - Express middleware
 * - Standalone HTTP servers
 *
 * @param headers - Request headers (key → value)
 * @param rawBody - Raw request body as string or Buffer (NOT parsed JSON)
 * @returns HTTP status code and response body string
 */
export async function handleGitHubWebhook(
  headers: Record<string, string | string[] | undefined>,
  rawBody: string | Buffer
): Promise<{ status: number; body: string }> {
  const signature = (headers["x-hub-signature-256"] ?? "") as string;
  const eventName = (headers["x-github-event"] ?? "") as string;
  const deliveryId = (headers["x-github-delivery"] ?? "") as string;

  if (!signature) {
    return { status: 400, body: "Missing X-Hub-Signature-256 header" };
  }

  if (!eventName) {
    return { status: 400, body: "Missing X-GitHub-Event header" };
  }

  const secret = process.env["GITHUB_WEBHOOK_SECRET"];
  if (!secret) {
    console.error("[webhook] GITHUB_WEBHOOK_SECRET not set");
    return { status: 500, body: "Server misconfiguration" };
  }

  const isValid = verifyWebhookSignature(secret, rawBody, signature);
  if (!isValid) {
    console.warn(`[webhook] Invalid signature for delivery=${deliveryId}`);
    return { status: 401, body: "Invalid webhook signature" };
  }

  try {
    const bodyStr =
      typeof rawBody === "string" ? rawBody : rawBody.toString("utf-8");

    await githubApp.webhooks.receive({
      id: deliveryId,
      // Octokit's EmitterWebhookEventName union is too narrow for dynamic dispatch — cast required
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      name: eventName as any,
      payload: JSON.parse(bodyStr),
    });

    return { status: 200, body: "OK" };
  } catch (err) {
    console.error("[webhook] Failed to process event:", err);
    return { status: 500, body: "Internal server error" };
  }
}

export { githubApp };
export { onIssueReady } from "./handlers/issues.js";
