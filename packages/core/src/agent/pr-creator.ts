import { execSync } from 'child_process';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import type { Patch, Plan } from '../types/index.js';
import type { Repository } from './test-runner.js';
import { applyPatchToClone } from './patch-applier.js';

const exec = promisify(execCb);

export interface CreatePROptions {
  patch: Patch;
  repo: Repository;
  octokit: OctokitForPR;
  issueNumber: number;
  issueTitle: string;
  plan?: Plan;
}

export interface PRResult {
  prNumber: number;
  prUrl: string;
  branch: string;
}

interface OctokitAuth {
  auth(params: { type: string }): Promise<{ token: string }>;
}

interface OctokitForPR extends OctokitAuth {
  rest: {
    repos: {
      get(params: { owner: string; repo: string }): Promise<{ data: { default_branch: string } }>;
    };
    pulls: {
      create(params: {
        owner: string;
        repo: string;
        title: string;
        head: string;
        base: string;
        body: string;
        draft: boolean;
      }): Promise<{ data: { number: number; html_url: string } }>;
    };
    issues: {
      addLabels(params: {
        owner: string;
        repo: string;
        issue_number: number;
        labels: string[];
      }): Promise<unknown>;
    };
  };
}

/**
 * Builds a PR body from the plan and changed files.
 * Pure function — no AI SDK required.
 */
function buildPRBody(options: {
  issueNumber: number;
  issueTitle: string;
  plan: Plan | undefined;
  changedFiles: string[];
}): string {
  const { issueNumber, issueTitle, plan, changedFiles } = options;
  const lines: string[] = [];

  lines.push(`## Summary`);
  lines.push('');

  if (plan?.approach) {
    lines.push(plan.approach);
    lines.push('');
  } else {
    lines.push(`Automated fix for issue #${issueNumber}: ${issueTitle}`);
    lines.push('');
  }

  if (plan?.steps && plan.steps.length > 0) {
    lines.push('## Changes');
    lines.push('');
    for (const step of plan.steps) {
      lines.push(`- ${step.description}`);
    }
    lines.push('');
  }

  if (changedFiles.length > 0) {
    lines.push('## Files Modified');
    lines.push('');
    for (const f of changedFiles) {
      lines.push(`- \`${f}\``);
    }
    lines.push('');
  }

  lines.push(`Closes #${issueNumber}`);

  return lines.join('\n');
}

/**
 * Extracts a list of changed file paths from a unified diff string.
 */
function extractChangedFiles(diff: string): string[] {
  const files: string[] = [];
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      const f = line.slice(6).trim();
      if (f && !files.includes(f)) {
        files.push(f);
      }
    }
  }
  return files;
}

/**
 * Creates a branch, applies the patch, pushes to GitHub, and opens a PR.
 *
 * @returns PRResult with PR number, URL, and branch name
 */
export async function createPR(options: CreatePROptions): Promise<PRResult> {
  const { patch, repo, octokit, issueNumber, issueTitle, plan } = options;
  const parts = repo.fullName.split('/');
  const owner = parts[0];
  const repoName = parts[1];

  if (!owner || !repoName) {
    throw new Error(`Invalid repo fullName: ${repo.fullName}`);
  }

  console.log(`[pr-creator] Creating PR for ${repo.fullName}#${issueNumber} on branch ${patch.branch}`);

  // Obtain installation token for authenticated git operations
  const { token } = await octokit.auth({ type: 'installation' });

  // Clone repo and apply patch in a temp directory
  const { dir, cleanup } = await applyPatchToClone({
    repoFullName: repo.fullName,
    branch: patch.branch,
    patch: patch.diff,
    installationToken: token,
  });

  try {
    // Configure git identity for commits
    await exec(`git -C "${dir}" config user.email "bot@codowave.com"`);
    await exec(`git -C "${dir}" config user.name "Codowave Bot"`);

    // Stage all changed files
    await exec(`git -C "${dir}" add -A`);

    // Check if there are any changes to commit
    const { stdout: statusOut } = await exec(`git -C "${dir}" status --porcelain`);
    if (statusOut.trim()) {
      // Escape commit message for shell
      const safeMsg = patch.commitMessage.replace(/"/g, '\\"').replace(/`/g, '\\`');
      await exec(`git -C "${dir}" commit -m "${safeMsg}"`);
    } else {
      console.log(`[pr-creator] No changes to commit — patch may have already been applied`);
    }

    // Push branch to remote
    const remoteUrl = `https://x-access-token:${token}@github.com/${repo.fullName}.git`;
    await exec(`git -C "${dir}" push "${remoteUrl}" "${patch.branch}:${patch.branch}" --force`);

    console.log(`[pr-creator] Pushed branch ${patch.branch} to ${repo.fullName}`);

    // Determine default branch
    const { data: repoData } = await octokit.rest.repos.get({ owner, repo: repoName });
    const defaultBranch = repoData.default_branch;

    // Build PR body
    const changedFiles = extractChangedFiles(patch.diff);
    const prBody = buildPRBody({ issueNumber, issueTitle, plan, changedFiles });

    // Open the pull request
    const { data: pr } = await octokit.rest.pulls.create({
      owner,
      repo: repoName,
      title: `fix: ${issueTitle} (#${issueNumber})`,
      head: patch.branch,
      base: defaultBranch,
      body: prBody,
      draft: false,
    });

    console.log(`[pr-creator] Opened PR #${pr.number}: ${pr.html_url}`);

    // Label the PR (best effort — label may not exist)
    await octokit.rest.issues.addLabels({
      owner,
      repo: repoName,
      issue_number: pr.number,
      labels: ['agent-created'],
    }).catch((err: Error) => {
      console.warn(`[pr-creator] Could not add label: ${err.message}`);
    });

    return {
      prNumber: pr.number,
      prUrl: pr.html_url,
      branch: patch.branch,
    };
  } finally {
    cleanup();
  }
}

/**
 * Generates a standardized branch name for a Codowave issue fix.
 * Format: codowave/issue-{N}-{slug}
 */
export function buildBranchName(issueNumber: number, issueTitle: string): string {
  const slug = issueTitle
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40)
    .replace(/-+$/, '');

  return `codowave/issue-${issueNumber}-${slug}`;
}
