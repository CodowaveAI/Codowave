import { githubApp } from "./app";
import { registerInstallationHandlers } from "./handlers/installation";
import { registerIssueHandlers } from "./handlers/issues";
import { registerPullRequestHandlers } from "./handlers/pull-request";
import { verifyWebhookSignature } from "./utils/signature";

// Register all event handlers
registerInstallationHandlers(githubApp);
registerIssueHandlers(githubApp);
registerPullRequestHandlers(githubApp);

// Global error handler
githubApp.webhooks.onError((error) => {
  console.error("[webhook] Error processing event:", error);
});

/**
 * Handles an incoming GitHub webhook request.
 * Can be used in Next.js Route Handler or standalone Express.
 */
export async function handleGitHubWebhook(
  headers: Record<string, string | string[] | undefined>,
  rawBody: string | Buffer
): Promise<{ status: number; body: string }> {
  const signature = (headers["x-hub-signature-256"] ?? "") as string;
  const eventName = (headers["x-github-event"] ?? "") as string;
  const deliveryId = (headers["x-github-delivery"] ?? "") as string;

  if (!signature) {
    return { status: 400, body: "Missing signature" };
  }

  const secret = process.env.GITHUB_WEBHOOK_SECRET!;
  const isValid = verifyWebhookSignature(rawBody, signature, secret);
  if (!isValid) {
    return { status: 401, body: "Invalid signature" };
  }

  try {
    await githubApp.webhooks.receive({
      id: deliveryId,
      name: eventName as any,
      payload: JSON.parse(typeof rawBody === "string" ? rawBody : rawBody.toString()),
    });
    return { status: 200, body: "OK" };
  } catch (err) {
    console.error("[webhook] Failed to process:", err);
    return { status: 500, body: "Internal error" };
  }
}

export { githubApp };
