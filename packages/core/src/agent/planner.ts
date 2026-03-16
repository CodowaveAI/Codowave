/**
 * Planner — Stage 2 of the Codowave agent pipeline
 *
 * Analyzes RepoContext and generates a Plan (approach + steps).
 * Uses AI to analyze the issue and relevant files, then produces a structured plan.
 */

import { generateObject } from 'ai';
import { z } from 'zod';
import { aiProvider, DEFAULT_MODEL } from './ai-client.js';
import type { RepoContext, Plan } from '../types/index.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PlanOptions {
  /** The repository context from ContextBuilder */
  context: RepoContext;
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Generates a Plan for the given RepoContext.
 * This is Stage 2 of the Codowave agent pipeline.
 */
export async function createPlan(options: PlanOptions): Promise<Plan> {
  const { context } = options;
  const { issue, relevantFiles } = context;

  console.log(`[planner] Creating plan for ${context.owner}/${context.repo}#${issue.number}`);

  // Build context for AI
  const filesContent = Object.entries(relevantFiles)
    .map(([path, content]) => `## ${path}\n\n${content.slice(0, 5000)}`)
    .join('\n\n---\n\n');

  const { object } = await generateObject({
    model: aiProvider(DEFAULT_MODEL),
    schema: z.object({
      approach: z
        .string()
        .describe('High-level approach to address this issue'),
      steps: z
        .array(
          z.object({
            description: z.string().describe('What this step does'),
            filesToModify: z
              .array(z.string())
              .describe('Files that need modification for this step'),
          }),
        )
        .describe('Ordered list of steps to implement the fix'),
      filesToModify: z
        .array(z.string())
        .describe('All files that will be modified'),
      questions: z
        .array(z.string())
        .optional()
        .describe('Questions that need clarification before proceeding'),
    }),
    prompt: `You are a software engineering planner. Analyze this GitHub issue and the relevant file contents to create a plan.

## Issue #${issue.number}: ${issue.title}

### Body:
${issue.body || '(no body)'}

### Labels:
${issue.labels.join(', ') || '(no labels)'}

### Relevant Files:
${filesContent || '(no files fetched)'}

Create a detailed plan to address this issue. Include:
1. A high-level approach
2. Ordered steps with file modifications
3. List of all files that will be modified
4. Any questions that need clarification (if any)

Be specific about which files need changes and what those changes should be.`,
  });

  console.log(`[planner] Plan created with ${object.steps.length} steps`);

  return {
    approach: object.approach,
    steps: object.steps,
    filesToModify: object.filesToModify,
    questions: object.questions,
  };
}
