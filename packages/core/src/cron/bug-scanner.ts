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

// ─── Task Definition ─────────────────────────────────────────────────────────

/**
 * Bug Scanner Task
 *
 * Scans commits from the last 7 days for potential bugs.
 * Can be triggered manually or scheduled via Trigger.dev dashboard.
 * Recommended cron: 0 9 * * 1,4 (Mon/Thu 9am UTC)
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
          const bugs = await analyzeCommitForBugs(commit, repositoryFullName);
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

        // Create issues for critical/high severity bugs
        const criticalHighBugs = allBugs.filter(
          (b) => b.severity === 'critical' || b.severity === 'high'
        );

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

        // Create summary issue
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
        success: true,
        repositoryFullName,
        scanDurationMs,
        commitsScanned: commits.length,
        bugsFound: allBugs.length,
        issuesCreated,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Bug scan failed for ${repositoryFullName}: ${errorMessage}`);

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
  author: { name: string; date: string };
  url: string;
}

async function fetchCommits(repositoryFullName: string, branch?: string): Promise<Commit[]> {
  const { Octokit } = await import('octokit');
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  const [owner = '', repo = ''] = repositoryFullName.split('/');
  
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
    message: commit.commit.message || '',
    author: { name: commit.commit.author?.name || 'unknown', date: commit.commit.author?.date || '' },
    url: commit.html_url,
  }));
}

async function getCommitDiff(repositoryFullName: string, commitSha: string): Promise<string> {
  const { Octokit } = await import('octokit');
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  const [owner = '', repo = ''] = repositoryFullName.split('/');

  const response = await octokit.request('GET /repos/{owner}/{repo}/commits/{ref}', {
    owner,
    repo,
    ref: commitSha,
  });

  const files = response.data.files || [];
  return files
    .map((file) => `## ${file.filename}\n+${file.additions} -${file.deletions}\n\n${file.patch || '(no diff)'}`)
    .join('\n\n---\n\n');
}

async function analyzeCommitForBugs(commit: Commit, repositoryFullName: string): Promise<BugFinding[]> {
  try {
    const diff = await getCommitDiff(repositoryFullName, commit.sha);
    if (!diff || diff.trim() === '' || diff.includes('(binary')) return [];

    const { object } = await generateObject({
      model: aiProvider(DEFAULT_MODEL),
      schema: z.object({
        bugs: z.array(z.object({
          filePath: z.string(),
          lineNumber: z.number().optional(),
          bugType: z.string(),
          severity: z.enum(['low', 'medium', 'high', 'critical']),
          description: z.string(),
          suggestedFix: z.string().optional(),
        })),
      }),
      prompt: `You are a bug detection expert. Analyze this git commit diff and identify bugs.

Commit: ${commit.sha} - ${commit.message}

Diff:
${diff}

Identify real bugs (null-pointer, race-condition, memory-leak, sql-injection, etc).
Return empty array if no real bugs found.`,
    });

    return object.bugs.map((bug) => ({
      commitSha: commit.sha,
      commitMessage: commit.message || '',
      filePath: bug.filePath,
      lineNumber: bug.lineNumber,
      bugType: bug.bugType,
      severity: bug.severity,
      description: bug.description,
      suggestedFix: bug.suggestedFix,
    }));
  } catch (error) {
    logger.warn(`AI analysis failed for ${commit.sha.slice(0, 7)}: ${error}`);
    return [];
  }
}

function generateBugIssueBody(bug: BugFinding, repo: string, branch: string): string {
  return `## Bug Found in Recent Commit

**Severity:** ${bug.severity.toUpperCase()}
**Type:** ${bug.bugType}
**File:** ${bug.filePath}
${bug.lineNumber ? `**Line:** ${bug.lineNumber}` : ''}

### Commit
- SHA: \`${bug.commitSha}\`
- Message: ${bug.commitMessage}

### Description

${bug.description}

${bug.suggestedFix ? `### Suggested Fix\n\n${bug.suggestedFix}` : ''}

---

*Auto-created by Codowave Bug Scanner*
*Branch: ${branch}*`;
}

function generateSummaryIssueBody(bugs: BugFinding[], repo: string, branch: string): string {
  const critical = bugs.filter((b) => b.severity === 'critical').length;
  const high = bugs.filter((b) => b.severity === 'high').length;
  const medium = bugs.filter((b) => b.severity === 'medium').length;
  const low = bugs.filter((b) => b.severity === 'low').length;

  return `## Bug Scanner Summary

Found **${bugs.length}** potential bug(s) in recent commits.

| Severity | Count |
|----------|-------|
| Critical | ${critical} |
| High | ${high} |
| Medium | ${medium} |
| Low | ${low} |

---

*Auto-created by Codowave Bug Scanner*
*Scan date: ${new Date().toISOString()}*`;
}

// Export task ID
export const BUG_SCANNER_TASK_ID = 'bug-scanner';
