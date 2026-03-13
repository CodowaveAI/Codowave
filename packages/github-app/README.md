# @codowave/github-app

GitHub App integration for Codowave — receives, verifies, and routes GitHub webhook events.

## Overview

This package provides:

- **`githubApp`** — Octokit `App` instance with HMAC-SHA256 webhook verification
- **`handleGitHubWebhook()`** — Framework-agnostic webhook handler (Next.js, Express, etc.)
- **`onIssueReady()`** — Subscribe to `issues.labeled → agent-ready` events

## Webhook Handler

The `handleGitHubWebhook()` function:

1. Validates `X-Hub-Signature-256` header using HMAC-SHA256
2. Routes events to registered handlers via `@octokit/webhooks`
3. Returns `{ status, body }` for the HTTP framework to respond with

### Next.js Route Handler

```typescript
// apps/web/app/api/github/webhook/route.ts
import { handleGitHubWebhook } from "@codowave/github-app";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const result = await handleGitHubWebhook(headers, rawBody);
  return NextResponse.json({ message: result.body }, { status: result.status });
}
```

### Express Middleware

```typescript
import express from "express";
import { handleGitHubWebhook } from "@codowave/github-app";

const app = express();

app.post(
  "/api/github/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const result = await handleGitHubWebhook(
      req.headers as Record<string, string>,
      req.body
    );
    res.status(result.status).send(result.body);
  }
);
```

## Event Handlers

### Issues (`issues.labeled`)

When an issue is labeled `agent-ready`:
1. Adds `in-progress` label to the issue
2. Removes `agent-ready` label
3. Fires all callbacks registered via `onIssueReady()`

```typescript
import { onIssueReady } from "@codowave/github-app";

onIssueReady(async ({ owner, repo, issueNumber, issueTitle, issueBody }) => {
  console.log(`Processing issue #${issueNumber}: ${issueTitle}`);
  // Enqueue your job here
});
```

### Installation (`installation.*`)

Logs installation lifecycle events (created/deleted/repos added/removed).
Extend with DB persistence in hosted deployments.

### Pull Requests (`pull_request.*`)

Matches Codowave branch pattern `codowave/issue-{N}-*` to track PR status.
Also handles `check_run.completed` for CI status monitoring.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GITHUB_APP_ID` | ✅ | GitHub App ID |
| `GITHUB_PRIVATE_KEY` | ✅ | PEM private key (raw or base64-encoded) |
| `GITHUB_WEBHOOK_SECRET` | ✅ | Webhook HMAC secret |
| `GITHUB_CLIENT_ID` | Optional | OAuth client ID |
| `GITHUB_CLIENT_SECRET` | Optional | OAuth client secret |

## Build

```bash
pnpm build      # Compile TypeScript
pnpm typecheck  # Type check without emitting
```
