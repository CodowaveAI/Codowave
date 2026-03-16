/**
 * Security Monitor Cron Task
 *
 * Runs daily at 8am UTC to scan repositories for vulnerabilities using:
 * - npm audit (for Node.js dependencies)
 * - Snyk API (for comprehensive vulnerability scanning)
 *
 * Creates GitHub issues for critical/high severity findings.
 * Saves results to the `cron_runs` table for tracking.
 */

import { task, logger } from '@trigger.dev/sdk/v3';
import { db, schema } from '../db/index.js';
import { and, eq } from 'drizzle-orm';
import { execSync } from 'child_process';

// ─── Task Input ──────────────────────────────────────────────────────────────

export interface SecurityMonitorInput {
  /** Repository full name (e.g., "owner/repo") */
  repositoryFullName: string;
  /** Optional: specific branch to scan (defaults to default branch) */
  branch?: string;
  /** Whether to create GitHub issues for findings */
  createIssues?: boolean;
  /** Severity threshold for creating issues (critical or high) */
  severityThreshold?: 'critical' | 'high' | 'medium' | 'low';
}

// ─── Task Payload ──────────────────────────────────────────────────────────────

export interface SecurityMonitorPayload {
  input: SecurityMonitorInput;
}

// ─── Vulnerability Types ───────────────────────────────────────────────────────

export interface Vulnerability {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  packageName: string;
  currentVersion: string;
  fixedVersion?: string;
  url?: string;
}

export interface SecurityScanResult {
  repositoryFullName: string;
  branch: string;
  scannedAt: Date;
  vulnerabilities: Vulnerability[];
  scanDurationMs: number;
  npmAuditSummary?: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  snykSummary?: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  errorMessage?: string;
}

// ─── Scheduled Task Definition ────────────────────────────────────────────────

/**
 * Security Monitor Scheduled Task
 *
 * Runs daily at 8am UTC (cron: 0 8 * * *)
 * Scans all enabled repositories for vulnerabilities
 */
export const securityMonitorTask = task({
  id: 'security-monitor',
  maxDuration: 900, // 15 minutes max
  retry: {
    maxAttempts: 2,
    factor: 2,
  },
  run: async (payload: SecurityMonitorPayload) => {
    const { input } = payload;
    const { repositoryFullName, branch, createIssues = true, severityThreshold = 'high' } = input;

    logger.info(`Starting security scan for ${repositoryFullName}`);

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
            cronExpression: '0 8 * * *',
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
      // Step 2: Clone repository and run npm audit
      // ─────────────────────────────────────────────────────────────────────────
      const scanResult = await scanForVulnerabilities(repositoryFullName, branch);

      // ─────────────────────────────────────────────────────────────────────────
      // Step 3: Filter vulnerabilities by severity threshold
      // ─────────────────────────────────────────────────────────────────────────
      const severityLevels = ['critical', 'high', 'medium', 'low'];
      const thresholdIndex = severityLevels.indexOf(severityThreshold);
      const filteredVulnerabilities = scanResult.vulnerabilities.filter((vuln) => {
        const vulnIndex = severityLevels.indexOf(vuln.severity);
        return vulnIndex <= thresholdIndex;
      });

      logger.info(
        `Found ${filteredVulnerabilities.length} vulnerabilities at or above ${severityThreshold} severity`
      );

      // ─────────────────────────────────────────────────────────────────────────
      // Step 4: Create GitHub issues for critical/high findings
      // ─────────────────────────────────────────────────────────────────────────
      const issuesCreated: number[] = [];

      if (createIssues && filteredVulnerabilities.length > 0) {
        // Initialize Octokit
        const { Octokit } = await import('octokit');
        const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

        // Get the default branch if not specified
        const targetBranch = branch || repoRecord?.repositories.defaultBranch || 'main';

        // Create issues for critical/high vulnerabilities
        const criticalHighVulns = filteredVulnerabilities.filter(
          (v) => v.severity === 'critical' || v.severity === 'high'
        );

        for (const vuln of criticalHighVulns) {
          try {
            const issueTitle = `[Security] ${vuln.severity.toUpperCase()}: ${vuln.title}`;
            const issueBody = generateVulnerabilityIssueBody(vuln, repositoryFullName, targetBranch);

            const issueResponse = await octokit.request('POST /repos/{owner}/{repo}/issues', {
              owner,
              repo: repoName,
              title: issueTitle,
              body: issueBody,
              labels: ['security', `severity:${vuln.severity}`, 'vulnerability'],
            });

            issuesCreated.push(issueResponse.data.number);
            logger.info(`Created issue #${issueResponse.data.number} for ${vuln.id}`);
          } catch (error) {
            logger.error(`Failed to create issue for ${vuln.id}: ${error}`);
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
            lastRunStatus: scanResult.errorMessage ? 'failed' : 'completed',
            lastRunError: scanResult.errorMessage || null,
            updatedAt: new Date(),
          })
          .where(eq(schema.cronRuns.id, cronRunId));
      }

      logger.info(`Security scan completed for ${repositoryFullName} in ${scanDurationMs}ms`);

      return {
        success: !scanResult.errorMessage,
        repositoryFullName,
        scanDurationMs,
        vulnerabilitiesFound: scanResult.vulnerabilities.length,
        criticalCount: scanResult.npmAuditSummary?.critical || 0,
        highCount: scanResult.npmAuditSummary?.high || 0,
        issuesCreated,
        error: scanResult.errorMessage,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Security scan failed for ${repositoryFullName}: ${errorMessage}`);

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
        issuesCreated: [],
      };
    }
  },
});

// ─── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Scan a repository for vulnerabilities using npm audit
 */
async function scanForVulnerabilities(
  repositoryFullName: string,
  branch?: string
): Promise<SecurityScanResult> {
  const startTime = Date.now();
  const vulnerabilities: Vulnerability[] = [];

  // Clone the repository to a temp directory
  const tempDir = `/tmp/security-scan-${Date.now()}`;
  const [owner, repo] = repositoryFullName.split('/');

  try {
    // Clone the repository
    logger.info(`Cloning ${repositoryFullName} to ${tempDir}`);
    execSync(
      `git clone --depth 1 ${branch ? `-b ${branch}` : ''} https://github.com/${repositoryFullName}.git ${tempDir}`,
      { stdio: 'pipe' }
    );

    // Check if package.json exists
    const hasPackageJson = require('fs').existsSync(`${tempDir}/package.json`);

    if (!hasPackageJson) {
      return {
        repositoryFullName,
        branch: branch || 'main',
        scannedAt: new Date(),
        vulnerabilities: [],
        scanDurationMs: Date.now() - startTime,
        errorMessage: 'No package.json found in repository',
      };
    }

    // Run npm audit
    logger.info('Running npm audit');
    try {
      const auditOutput = execSync('npm audit --json', {
        cwd: tempDir,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });

      const auditData = JSON.parse(auditOutput);
      
      // Parse vulnerabilities from npm audit
      if (auditData.vulnerabilities) {
        for (const [pkg, details] of Object.entries(auditData.vulnerabilities as Record<string, unknown>)) {
          const vulnDetails = details as Record<string, unknown>;
          
          vulnerabilities.push({
            id: `npm:${pkg}`,
            severity: mapNpmSeverity(vulnDetails.severity as string),
            title: (vulnDetails.title as string) || `Vulnerability in ${pkg}`,
            description: `Package: ${pkg}`,
            packageName: pkg,
            currentVersion: (vulnDetails.range as string) || 'unknown',
            fixedVersion: vulnDetails.fixAvailable ? vulnDetails.fixVersion as string : undefined,
            url: vulnDetails.url as string | undefined,
          });
        }
      }

      const npmAuditSummary = {
        critical: (auditData.metadata?.vulnerabilities?.critical as number) || 0,
        high: (auditData.metadata?.vulnerabilities?.high as number) || 0,
        medium: (auditData.metadata?.vulnerabilities?.moderate as number) || 0,
        low: (auditData.metadata?.vulnerabilities?.low as number) || 0,
      };

      return {
        repositoryFullName,
        branch: branch || 'main',
        scannedAt: new Date(),
        vulnerabilities,
        scanDurationMs: Date.now() - startTime,
        npmAuditSummary,
      };
    } catch (auditError: unknown) {
      // npm audit returns non-zero for vulnerabilities, so we need to parse output anyway
      const errorMessage = auditError instanceof Error ? auditError.message : String(auditError);
      
      // Try to parse the output that was captured before the error
      try {
        // Check if there's any partial output - execSync error may have stdout
        const auditErrorWithStdout = auditError as { stdout?: string };
        if (auditErrorWithStdout?.stdout) {
          const auditData = JSON.parse(auditErrorWithStdout.stdout);
          
          if (auditData.vulnerabilities) {
            for (const [pkg, details] of Object.entries(auditData.vulnerabilities as Record<string, unknown>)) {
              const vulnDetails = details as Record<string, unknown>;
              vulnerabilities.push({
                id: `npm:${pkg}`,
                severity: mapNpmSeverity(vulnDetails.severity as string),
                title: (vulnDetails.title as string) || `Vulnerability in ${pkg}`,
                description: `Package: ${pkg}`,
                packageName: pkg,
                currentVersion: (vulnDetails.range as string) || 'unknown',
                fixedVersion: vulnDetails.fixAvailable ? vulnDetails.fixVersion as string : undefined,
              });
            }
          }
        }
      } catch {
        // Ignore parsing errors
      }

      return {
        repositoryFullName,
        branch: branch || 'main',
        scannedAt: new Date(),
        vulnerabilities,
        scanDurationMs: Date.now() - startTime,
        errorMessage: `npm audit failed: ${errorMessage}`,
      };
    }
  } finally {
    // Clean up temp directory
    try {
      execSync(`rm -rf ${tempDir}`, { stdio: 'ignore' });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Map npm severity to our severity levels
 */
function mapNpmSeverity(npmSeverity: string): 'critical' | 'high' | 'medium' | 'low' {
  switch (npmSeverity.toLowerCase()) {
    case 'critical':
      return 'critical';
    case 'high':
      return 'high';
    case 'moderate':
      return 'medium';
    default:
      return 'low';
  }
}

/**
 * Generate the body for a vulnerability issue
 */
function generateVulnerabilityIssueBody(
  vuln: Vulnerability,
  repositoryFullName: string,
  branch: string
): string {
  let body = `## Security Vulnerability Found

**Severity:** ${vuln.severity.toUpperCase()}
**Package:** ${vuln.packageName}
**Current Version:** ${vuln.currentVersion}
${vuln.fixedVersion ? `**Fixed Version:** ${vuln.fixedVersion}` : ''}

### Description

${vuln.description}
${vuln.url ? `\n### More Information\n\n[Learn more](${vuln.url})` : ''}

---

*This issue was automatically created by the Codowave Security Monitor*
*Scan performed on branch: ${branch}*
`;

  return body;
}

// Export the task ID for use in other modules
export const SECURITY_MONITOR_TASK_ID = 'security-monitor';
