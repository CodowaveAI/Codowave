/**
 * ContextBuilder — Stage 1 of the Codowave agent pipeline
 *
 * Fetches issue + comments, retrieves the repo file tree via Octokit,
 * uses AI to identify relevant files, then returns a populated RepoContext
 * for use by the Planner and Coder stages.
 */

import { generateObject } from 'ai';
import { z } from 'zod';
import { aiProvider, DEFAULT_MODEL } from './ai-client.js';
import type { RepoContext, Issue } from '../types/index.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum bytes to fetch per file (50 KB) */
const MAX_FILE_SIZE_BYTES = 50_000;

/** Max files AI may select as relevant */
const MAX_RELEVANT_FILES = 20;

/** Truncate tree in prompt to avoid overwhelming the context window */
const MAX_TREE_FILES_IN_PROMPT = 500;

/** Extensions / path segments to ignore in the file tree */
const IGNORED_PATTERNS: RegExp[] = [
  /^node_modules\//,
  /^\.git\//,
  /^dist\//,
  /^build\//,
  /^\.next\//,
  /^coverage\//,
  /\.(png|jpg|jpeg|gif|svg|ico|webp|pdf|zip|tar|gz|woff2?|eot|ttf)$/i,
  /^pnpm-lock\.yaml$/,
  /^package-lock\.json$/,
  /^yarn\.lock$/,
];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BuildContextOptions {
  /** Installation-scoped Octokit instance */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  octokit: any;
  owner: string;
  repoName: string;
  issueNumber: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isIgnored(path: string): boolean {
  return IGNORED_PATTERNS.some((p) => p.test(path));
}

/**
 * Recursively fetches all blob paths in a repo using the Git trees API.
 * Returns a flat array of file paths.
 */
async function getFileTree(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  octokit: any,
  owner: string,
  repo: string,
  ref: string,
): Promise<string[]> {
  try {
    const { data } = await octokit.rest.git.getTree({
      owner,
      repo,
      tree_sha: ref,
      recursive: '1',
    });
    return (data.tree as Array<{ type: string; path: string }>)
      .filter((item) => item.type === 'blob')
      .map((item) => item.path)
      .filter((path) => !isIgnored(path));
  } catch (err) {
    console.warn('[context-builder] Failed to fetch file tree:', err);
    return [];
  }
}

/**
 * Fetches a single file's decoded content from GitHub.
 * Returns null if the file is too large, binary, or inaccessible.
 */
async function fetchFileContent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  octokit: any,
  owner: string,
  repo: string,
  path: string,
): Promise<string | null> {
  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path });
    if (Array.isArray(data) || data.type !== 'file') return null;
    if ((data.size ?? 0) > MAX_FILE_SIZE_BYTES) return null;
    if (!data.content) return null;
    return Buffer.from(data.content, 'base64').toString('utf-8');
  } catch {
    return null;
  }
}

/**
 * Calls the AI to determine which files in the tree are most relevant
 * to the given issue. Filters the result against the actual tree set.
 */
async function identifyRelevantFiles(
  fileTree: string[],
  issueTitle: string,
  issueBody: string,
  commentsText: string,
): Promise<string[]> {
  const treeSlice = fileTree.slice(0, MAX_TREE_FILES_IN_PROMPT);
  const overflow =
    fileTree.length > MAX_TREE_FILES_IN_PROMPT
      ? `\n(${fileTree.length - MAX_TREE_FILES_IN_PROMPT} additional files omitted)`
      : '';

  const { object } = await generateObject({
    model: aiProvider(DEFAULT_MODEL),
    schema: z.object({
      relevantFiles: z
        .array(z.string())
        .max(MAX_RELEVANT_FILES)
        .describe('File paths (from the tree) most relevant to implementing / fixing this issue'),
      reasoning: z
        .string()
        .describe('Brief explanation of why these files were selected'),
    }),
    prompt: `You are analysing a GitHub repository to identify which files are relevant to a GitHub issue.

## Issue: ${issueTitle}

### Body:
${issueBody || '(no body)'}
${commentsText ? `\n### Comments:\n${commentsText}` : ''}

## Repository File Tree:
\`\`\`
${treeSlice.join('\n')}${overflow}
\`\`\`

Select up to ${MAX_RELEVANT_FILES} file paths from the tree above that are most likely to need reading or modification to address this issue.
Only include paths that appear verbatim in the tree.`,
  });

  const treeSet = new Set(fileTree);
  return object.relevantFiles.filter((f) => treeSet.has(f));
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Builds a complete RepoContext for the given issue.
 * This is Stage 1 of the Codowave agent pipeline.
 */
export async function buildContext(options: BuildContextOptions): Promise<RepoContext> {
  const { octokit, owner, repoName, issueNumber } = options;

  console.log(`[context-builder] Building context for ${owner}/${repoName}#${issueNumber}`);

  // 1. Fetch issue details
  const { data: ghIssue } = await octokit.rest.issues.get({
    owner,
    repo: repoName,
    issue_number: issueNumber,
  });

  // 2. Fetch comments (up to 50)
  const { data: commentsData } = await octokit.rest.issues.listComments({
    owner,
    repo: repoName,
    issue_number: issueNumber,
    per_page: 50,
  });

  const commentsText = commentsData
    .map((c: { user?: { login: string }; body?: string }) => `@${c.user?.login ?? 'unknown'}: ${c.body ?? ''}`)
    .join('\n\n');

  const issue: Issue = {
    number: ghIssue.number,
    title: ghIssue.title,
    body: ghIssue.body ?? '',
    labels: ghIssue.labels.map(
      (l: string | { name?: string }) => (typeof l === 'string' ? l : (l.name ?? '')),
    ),
    url: ghIssue.html_url,
  };

  // 3. Determine default branch
  const { data: repoData } = await octokit.rest.repos.get({ owner, repo: repoName });
  const defaultBranch: string = repoData.default_branch ?? 'main';

  // 4. Fetch full file tree
  const fileTree = await getFileTree(octokit, owner, repoName, defaultBranch);
  console.log(`[context-builder] File tree: ${fileTree.length} files`);

  // 5. AI selects relevant file paths
  const relevantPaths = await identifyRelevantFiles(
    fileTree,
    issue.title,
    issue.body,
    commentsText,
  );
  console.log(`[context-builder] Relevant files: ${relevantPaths.join(', ')}`);

  // 6. Fetch file contents in parallel
  const contentEntries = await Promise.all(
    relevantPaths.map(async (path) => {
      const content = await fetchFileContent(octokit, owner, repoName, path);
      return [path, content] as const;
    }),
  );

  const relevantFiles: Record<string, string> = {};
  for (const [path, content] of contentEntries) {
    if (content !== null) {
      relevantFiles[path] = content;
    }
  }

  console.log(
    `[context-builder] Fetched ${Object.keys(relevantFiles).length} file contents`,
  );

  return {
    owner,
    repo: repoName,
    defaultBranch,
    issue,
    fileTree,
    relevantFiles,
  };
}
