export interface Issue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  url: string;
}

export interface RepoContext {
  owner: string;
  repo: string;
  defaultBranch: string;
  issue: Issue;
  fileTree: string[];
  relevantFiles: Record<string, string>;
}

export interface PlanStep {
  description: string;
  filesToModify: string[];
}

export interface Plan {
  approach: string;
  steps: PlanStep[];
  filesToModify: string[];
  questions?: string[];
}

export interface Patch {
  diff: string;
  branch: string;
  commitMessage: string;
}

export interface TestResult {
  suite: 'unit' | 'playwright' | 'lint' | 'typecheck';
  passed: boolean;
  durationMs: number;
  log: string;
}

export type RunStatus =
  | 'queued'
  | 'planning'
  | 'awaiting_plan_approval'
  | 'coding'
  | 'testing'
  | 'pr_open'
  | 'awaiting_merge_approval'
  | 'merged'
  | 'failed'
  | 'cancelled';

export interface Run {
  id: string;
  repoFullName: string;
  issueNumber: number;
  status: RunStatus;
  plan?: Plan;
  patch?: Patch;
  prNumber?: number;
  prUrl?: string;
  retryCount: number;
  startedAt: Date;
}
