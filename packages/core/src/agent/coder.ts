/**
 * Coder — Stage 3 of the Codowave agent pipeline
 *
 * Takes a Plan + RepoContext and generates a Patch (diff).
 * Uses AI to analyze the files and generate the code changes.
 */

import { generateObject } from 'ai';
import { z } from 'zod';
import { aiProvider, DEFAULT_MODEL } from './ai-client.js';
import type { RepoContext, Plan, Patch } from '../types/index.js';
import { buildBranchName } from './pr-creator.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CodeOptions {
  /** The repository context from ContextBuilder */
  context: RepoContext;
  /** The plan from Planner */
  plan: Plan;
  /** Issue number for branch naming */
  issueNumber: number;
  /** Issue title for branch naming */
  issueTitle: string;
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Generates a Patch for the given Plan and RepoContext.
 * This is Stage 3 of the Codowave agent pipeline.
 */
export async function generateCode(options: CodeOptions): Promise<Patch> {
  const { context, plan, issueNumber, issueTitle } = options;
  const { owner, repo, relevantFiles } = context;

  console.log(`[coder] Generating code for ${owner}/${repo}#${issueNumber}`);

  // Build context for AI - include files that need modification
  const filesToModify = plan.filesToModify || [];
  const relevantContent: Record<string, string> = {};

  for (const file of filesToModify) {
    if (relevantFiles[file]) {
      relevantContent[file] = relevantFiles[file];
    }
  }

  const filesContent = Object.entries(relevantContent)
    .map(([path, content]) => `## ${path}\n\n${content.slice(0, 8000)}`)
    .join('\n\n---\n\n');

  const stepsText = plan.steps
    .map((step, i) => `${i + 1}. ${step.description}\n   Files: ${step.filesToModify.join(', ')}`)
    .join('\n');

  const { object } = await generateObject({
    model: aiProvider(DEFAULT_MODEL),
    schema: z.object({
      diff: z
        .string()
        .describe('Unified diff of all changes (git diff format)'),
      commitMessage: z
        .string()
        .describe('Commit message for these changes'),
    }),
    prompt: `You are a software engineering coder. Generate the code changes to address this issue.

## Issue #${issueNumber}: ${issueTitle}

### Approach:
${plan.approach}

### Steps:
${stepsText}

### Files to modify:
${filesToModify.join(', ')}

### Current file contents:
${filesContent || '(no files available)'}

Generate a unified diff (git diff format) with the changes needed to implement this fix.
Include a clear, descriptive commit message.

Respond with:
1. diff: The unified diff string
2. commitMessage: A concise commit message describing the changes`,
  });

  const branch = buildBranchName(issueNumber, issueTitle);

  console.log(`[coder] Code generated on branch ${branch}`);

  return {
    diff: object.diff,
    branch,
    commitMessage: object.commitMessage,
  };
}
