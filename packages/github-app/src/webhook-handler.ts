import type { RepoContext } from '@codowave/core';

export interface WebhookPayload {
  action: string;
  issue?: {
    number: number;
    title: string;
    body: string | null;
    labels: Array<{ name: string }>;
    html_url: string;
  };
  repository: {
    full_name: string;
    default_branch: string;
    owner: { login: string };
    name: string;
  };
}

export function buildRepoContext(payload: WebhookPayload): RepoContext | null {
  if (!payload.issue) return null;

  return {
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    defaultBranch: payload.repository.default_branch,
    issue: {
      number: payload.issue.number,
      title: payload.issue.title,
      body: payload.issue.body ?? '',
      labels: payload.issue.labels.map(l => l.name),
      url: payload.issue.html_url,
    },
    fileTree: [],
    relevantFiles: {},
  };
}
