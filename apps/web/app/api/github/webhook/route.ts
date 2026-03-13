import { handleGitHubWebhook } from "@codowave/github-app";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs"; // Required for raw body access

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => { headers[key] = value; });

  const result = await handleGitHubWebhook(headers, rawBody);
  return NextResponse.json({ message: result.body }, { status: result.status });
}
