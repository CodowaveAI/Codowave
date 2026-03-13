import { App } from "@octokit/app";

if (!process.env.GITHUB_APP_ID?.trim()) throw new Error("GITHUB_APP_ID is required");
if (!process.env.GITHUB_PRIVATE_KEY) throw new Error("GITHUB_PRIVATE_KEY is required");
if (!process.env.GITHUB_WEBHOOK_SECRET) throw new Error("GITHUB_WEBHOOK_SECRET is required");
if (!process.env.GITHUB_CLIENT_ID) throw new Error("GITHUB_CLIENT_ID is required");
if (!process.env.GITHUB_CLIENT_SECRET) throw new Error("GITHUB_CLIENT_SECRET is required");

// Private key may be base64-encoded in env
const rawKey = process.env.GITHUB_PRIVATE_KEY;
const privateKey =
  rawKey.includes("BEGIN RSA") || rawKey.includes("BEGIN EC")
    ? rawKey
    : Buffer.from(rawKey, "base64").toString("utf-8");

export const githubApp = new App({
  appId: process.env.GITHUB_APP_ID,
  privateKey,
  webhooks: {
    secret: process.env.GITHUB_WEBHOOK_SECRET,
  },
  oauth: {
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
  },
});

export type GitHubApp = typeof githubApp;
