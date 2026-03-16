/**
 * Bug Scanner Cron Task
 *
 * Runs every Monday and Thursday at 9am UTC (cron: 0 9 * * 1,4)
 * to scan commits from the last 7 days for potential bugs.
 *
 * Uses AI to analyze code diffs and identify bugs, then creates
 * GitHub issues for any findings. Saves results to `cron_runs` table.
 */

import { task, logger } from '@trigger.dev/sdk/v3';
import { db, schema } from '../db/index.js';
import { and, eq } from 'drizzle-orm';
import { generateObject } from 'ai';
import { z } from 'zod';
import { aiProvider, DEFAULT_MODEL } from '../agent/ai-client.js';
import { execSync } from 'child_process';

// ─── Task Input ──────────────────────────────────────────────────────────────

export interface BugScannerInput {
  /** Repository full name (e.g., "owner/repo") */
  repositoryFullName: string;
  /** Optional: specific branch to scan (defaults to default branch) */
  branch?: string;
  /** Whether to create GitHub issues for findings */
  createIssues?: boolean;
}

// ─── Task Payload ──────────────────────────────────────────────────────────────

export interface BugScannerPayload {
  input: BugScannerInput;
}

// ─── Bug Types ────────────────────────────────────────────────────────────────

export interface BugFinding {
  commitSha: string;
  commitMessage: string;
  filePath: string;
  lineNumber?: number;
  bugType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  suggestedFix?: string;
}

export interface BugScanResult {
  repositoryFullName: string;
  branch: string;
  scannedAt: Date;
  commitsScanned: number;
  bugsFound: BugFinding[];
  scanDurationMs: number;
  errorMessage?: string;
}

// ─── Scheduled Task Definition ────────────────────────────────────────────────

/**
 * Bug Scanner Scheduled Task
 *
 * Runs every Monday (1) and Thursday (4) at 9am UTC
 * Scans commits from the last 7 days for potential bugs
 */
export const bugScannerTask = task({
  id: 'bug-scanner',
  maxDuration: 900, // 15 minutes max
  retry: {
    maxAttempts: 2,
    factor: 2,
  },
  run: async (payload: BugScannerPayload) => {
    const { input } = payload;
    const { repositoryFullName, branch, createIssues = true } = input;

    logger.info(`Starting bug scan for ${repositoryFullName}`);

    const startTime = Date.now();
    let cronRunId: string | undefined;

    try {
      // ─────────────────────────────────────────────────────────────────────────
      // Step 1: Parse repository and find in database
      // ─────────────────────────────────────────────────────────────────────────
      const [owner, repoName] = repositoryFullName.split('/');
      if (!owner || !repoName) {
        throw new Error(`Invalid repository name: ${repositoryFullName}`);
      }

      // Find the repository in the database
      const repoRecords = await db
        .select()
        .from(schema.repositories)
        .innerJoin(schema.installations, eq(schema.repositories.installationId, schema.installations.id))
        .where(and(
          eq(schema.repositories.fullName, repositoryFullName),
          eq(schema.repositories.enabled, true)
        ))
        .limit(1);

      const repoRecord = repoRecords[0];
      const repositoryId = repoRecord?.repositories.id;
      const userId = repoRecord?.repositories.userId;

      // Create cron run record
      if (repositoryId && userId) {
        const [cronRun] = await db
          .insert(schema.cronRuns)
          .values({
            userId: userId,
            repositoryId: repositoryId,
            cronExpression: '0 9 * * 1,4',
            enabled: true,
            lastRunAt: new Date(),
            lastRunStatus: 'running',
          })
          .returning();
        
        if (cronRun) {
          cronRunId = cronRun.id;
          logger.info(`Created cron run record ${cronRunId}`);
        }
      }

      // ─────────────────────────────────────────────────────────────────────────
      // Step 2: Fetch commits from the last 7 days
      // ─────────────────────────────────────────────────────────────────────────
      const commits = await fetchCommits(repositoryFullName, branch);
      logger.info(`Found ${commits.length} commits in the last 7 days`);

      // ─────────────────────────────────────────────────────────────────────────
      // Step 3: Analyze each commit for potential bugs using AI
      // ─────────────────────────────────────────────────────────────────────────
      const allBugs: BugFinding[] = [];

      for (const commit of commits) {
        try {
          const bugs = await analyzeCommitForBugs(commit, repositoryFullName, branch);
          allBugs.push(...bugs);
          logger.info(`Found ${bugs.length} potential bugs in commit ${commit.sha.slice(0, 7)}`);
        } catch (error) {
          logger.warn(`Failed to analyze commit ${commit.sha}: ${error}`);
        }
      }

      logger.info(`Total bugs found: ${allBugs.length}`);

      // ─────────────────────────────────────────────────────────────────────────
      // Step 4: Create GitHub issues for bug findings
      // ─────────────────────────────────────────────────────────────────────────
      const issuesCreated: number[] = [];

      if (createIssues && allBugs.length > 0) {
        // Initialize Octokit
        const { Octokit } = await import('octokit');
        const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

        // Get the default branch if not specified
        const targetBranch = branch || repoRecord?.repositories.defaultBranch || 'main';

        // Group bugs by severity for better issue organization
        const criticalHighBugs = allBugs.filter(
          (b) => b.severity === 'critical' || b.severity === 'high'
        );

        // Create issues for critical/high severity bugs
        for (const bug of criticalHighBugs) {
          try {
            const issueTitle = `[Bug] ${bug.bugType}: ${bug.description.slice(0, 50)}`;
            const issueBody = generateBugIssueBody(bug, repositoryFullName, targetBranch);

            const issueResponse = await octokit.request('POST /repos/{owner}/{repo}/issues', {
              owner,
              repo: repoName,
              title: issueTitle,
              body: issueBody,
              labels: ['bug', `severity:${bug.severity}`, 'automated-scan'],
            });

            issuesCreated.push(issueResponse.data.number);
            logger.info(`Created issue #${issueResponse.data.number} for bug in ${bug.filePath}`);
          } catch (error) {
            logger.error(`Failed to create issue for bug in ${bug.filePath}: ${error}`);
          }
        }

        // Also create a summary issue for all bugs found
        if (allBugs.length > 0) {
          try {
            const summaryBody = generateSummaryIssueBody(allBugs, repositoryFullName, targetBranch);
            const summaryIssue = await octokit.request('POST /repos/{owner}/{repo}/issues', {
              owner,
              repo: repoName,
              title: `[Bug Scanner] Found ${allBugs.length} potential bugs in recent commits`,
              body: summaryBody,
              labels: ['bug', 'automated-scan', 'scan-summary'],
            });
            issuesCreated.push(summaryIssue.data.number);
            logger.info(`Created summary issue #${summaryIssue.data.number}`);
          } catch (error) {
            logger.error(`Failed to create summary issue: ${error}`);
          }
        }
      }

      // ─────────────────────────────────────────────────────────────────────────
      // Step 5: Update cron run record
      // ─────────────────────────────────────────────────────────────────────────
      const scanDurationMs = Date.now() - startTime;

      if (cronRunId) {
        await db
          .update(schema.cronRuns)
          .set({
            lastRunAt: new Date(),
            lastRunStatus: 'completed',
            lastRunError: null,
            updatedAt: new Date(),
          })
          .where(eq(schema.cronRuns.id, cronRunId));
      }

      logger.info(`Bug scan completed for ${repositoryFullName} in ${scanDurationMs}ms`);

      return {
        success: !scanDurationMs || true,
        repositoryFullName,
        scanDurationMs,
        commitsScanned: commits.length,
        bugsFound: allBugs.length,
        issuesCreated,
        error: undefined,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Bug scan failed for ${repositoryFullName}: ${errorMessage}`);

      // Update cron run with error status
      if (cronRunId) {
        await db
          .update(schema.cronRuns)
          .set({
            lastRunStatus: 'failed',
            lastRunError: errorMessage,
            updatedAt: new Date(),
          })
          .where(eq(schema.cronRuns.id, cronRunId));
      }

      return {
        success: false,
        repositoryFullName,
        error: errorMessage,
        bugsFound: [],
        issuesCreated: [],
      };
    }
  },
});

// ─── Helper Functions ─────────────────────────────────────────────────────────

interface Commit {
  sha: string;
  message: string;
  author: {
    name: string;
    date: string;
  };
  url: string;
}

/**
 * Fetch commits from the last 7 days using GitHub API
 */
async function fetchCommits(
  repositoryFullName: string,
  branch?: string
): Promise<Commit[]> {
  const { Octokit } = await import('octokit');
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

  const parts = repositoryFullName.split('/');
  const owner = parts[0] ?? '';
  const repo = parts[1] ?? '';
  
  // Calculate date 7 days ago
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - 7);

  const response = await octokit.request('GET /repos/{owner}/{repo}/commits', {
    owner,
    repo,
    sha: branch,
    since: sinceDate.toISOString(),
    per_page: 100,
  });

  return response.data.map((commit) => ({
    sha: commit.sha,
    message: commit.commit.message,
    author: {
      name: commit.commit.author?.name || 'unknown',
      date: commit.commit.author?.date || '',
    },
    url: commit.html_url,
  }));
}

/**
 * Fetch the diff for a specific commit
 */
async function getCommitDiff(
  repositoryFullName: string,
  commitSha: string
): Promise<string> {
  const { Octokit } = await import('octokit');
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

  const parts = repositoryFullName.split('/');
  const owner = parts[0] ?? '';
  const repo = parts[1] ?? '';

  const response = await octokit.request('GET /repos/{owner}/{repo}/commits/{ref}', {
    owner,
    repo,
    ref: commitSha,
  });

  // Format the diff from the commit data
  const files = response.data.files || [];
  return files
    .map((file) => {
      const additions = file.additions || 0;
      const deletions = file.deletions || 0;
      const changes = file.changes || 0;
      return `## ${file.filename}\n+${additions} -${deletions} (${changes} changes)\n\n${file.patch || '(binary file or no diff available)'}`;
    })
    .join('\n\n---\n\n');
}

/**
 * Analyze a commit for potential bugs using AI
 */
async function analyzeCommitForBugs(
  commit: Commit,
  repositoryFullName: string,
  branch?: string
): Promise<BugFinding[]> {
  try {
    // Get the commit diff
    const diff = await getCommitDiff(repositoryFullName, commit.sha);

    if (!diff || diff.trim() === '' || diff.includes('(binary file')) {
      return [];
    }

    // Use AI to analyze the diff for bugs
    const { object } = await generateObject({
      model: aiProvider(DEFAULT_MODEL),
      schema: z.object({
        bugs: z.array(
          z.object({
            filePath: z.string().describe('The file path that contains the bug'),
            lineNumber: z.number().optional().describe('Approximate line number'),
            bugType: z.string().describe('Type of bug (e.g., null-pointer, race-condition, memory-leak)'),
            severity: z.enum(['low', 'medium', 'high', 'critical']).describe('Bug severity'),
            description: z.string().describe('Description of the bug'),
            suggestedFix: z.string().optional().describe('Suggested fix if obvious'),
          }),
        ).describe('Array of bugs found in this commit. Empty if no bugs found.'),
      }),
      prompt: `You are an expert code reviewer specializing in bug detection. Analyze this git commit diff and identify any potential bugs.

## Commit Information
- SHA: ${commit.sha}
- Message: ${commit.message}
- Author: ${commit.author.name}
- Date: ${commit.author.date}

## Diff
${diff}

For each bug found, provide:
1. The file path
2. Approximate line number (if identifiable from the diff)
3. Bug type (e.g., null-pointer, race-condition, memory-leak, off-by-one, sql-injection, etc.)
4. Severity (low, medium, high, critical)
5. Description of the bug
6. Suggested fix (if obvious)

Focus on real bugs that could cause:
- Crashes or exceptions
- Security vulnerabilities
- Race conditions
- Memory leaks
- Null/undefined errors
- Logic errors
- Resource leaks

Ignore:
- Style issues
- Comment changes
- Documentation updates
- Minor refactoring without functional changes

Return an empty array if no real bugs are found.`,
    });

    // Map the AI response to our BugFinding type
    return object.bugs.map((bug) => ({
      commitSha: commit.sha,
      commitMessage: commit.message,
      filePath: bug.filePath,
      lineNumber: bug.lineNumber,
      bugType: bug.bugType,
      severity: bug.severity,
      description: bug.description,
      suggestedFix: bug.suggestedFix,
    }));
  } catch (error) {
    logger.warn(`AI analysis failed for commit ${commit.sha.slice(0, 7)}: ${error}`);
    return [];
  }
}

/**
 * Generate the body for a bug issue
 */
function generateBugIssueBody(
  bug: BugFinding,
  repositoryFullName: string,
  branch: string
): string {
  let body = `## Bug Found in Recent Commit

**Severity:** ${bug.severity.toUpperCase()}
**Type:** ${bug.bugType}
**File:** ${bug.filePath}
${bug.lineNumber ? `**Line:** ${bug.lineNumber}` : ''}

### Commit
- SHA: \`${bug.commitSha}\`
- Message: ${bug.commitMessage}

### Description

${bug.description}

${bug.suggestedFix ? `### Suggested Fix

${bug.suggestedFix}` : ''}

---

*This issue was automatically created by the Codowave Bug Scanner*
*Branch: ${branch}*
`;

  return body;
}

/**
 * Generate the body for a summary issue
 */
function generateSummaryIssueBody(
  bugs: BugFinding[],
  repositoryFullName: string,
  branch: string
): string {
  // Group bugs by severity
  const critical = bugs.filter((b) => b.severity === 'critical');
  const high = bugs.filter((b) => b.severity === 'high');
  const medium = bugs.filter((b) => b.severity === 'medium');
  const low = bugs.filter((b) => b.severity === 'low');

  let body = `## Bug Scanner Summary

This scan found **${bugs.length}** potential bug(s) in recent commits.

### Summary by Severity

| Severity | Count |
|----------|-------|
| Critical | ${critical.length} |
| High | ${high.length} |
| Medium | ${medium.length} |
| Low | ${low.length} |

${critical.length + high.length > 0 ? `### Critical & High Severity Bugs

${[...critical, ...high]
  .map((bug) => `#### ${bug.filePath} (${bug.severity.toUpperCase()})

- **Type:** ${bug.bugType}
- **Commit:** \`${bug.commitSha.slice(0, 7)}\`
- **Description:** ${bug.description}
${bug.suggestedFix ? `- **Suggested Fix:** ${bug.suggestedFix}` : ''}
`)
  .join('\n')}` : ''}

---

*This issue was automatically created by the Codowave Bug Scanner*
*Scan performed on branch: ${branch}*
*Scan date: ${new Date().toISOString()}*
`;

  return body;
}

// Export the task ID for use in other modules
export const BUG_SCANNER_TASK_ID = 'bug-scanner';
