import type { Patch, TestResult } from '../types/index.js';
import { GitHubActionsTestRunner } from './test-runners/github-actions-runner.js';

/**
 * Repository configuration passed to test runners.
 */
export interface Repository {
  /** e.g. "owner/repo" */
  fullName: string;
  /** CI workflow file name, defaults to "ci.yml" */
  ciWorkflowFile?: string;
  /** Override the default test command (used by Docker runner) */
  testCommand?: string;
}

export interface TestRunner {
  run(patch: Patch, repo: Repository, octokit: unknown): Promise<TestResult[]>;
}

export interface RunTestsOptions {
  patch: Patch;
  repo: Repository;
  octokit: unknown;
}

/**
 * Returns the appropriate TestRunner based on repository configuration.
 * OSS repos use GitHub Actions.
 */
export function getTestRunner(_repo: Repository): TestRunner {
  return new GitHubActionsTestRunner();
}

/**
 * Convenience: pick runner and run tests.
 */
export async function runTests(options: RunTestsOptions): Promise<TestResult[]> {
  const { patch, repo, octokit } = options;
  const runner = getTestRunner(repo);
  console.log(`[test-runner] Using ${runner.constructor.name} for repo ${repo.fullName}`);
  return runner.run(patch, repo, octokit);
}
