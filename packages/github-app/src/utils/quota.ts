/**
 * Quota management utilities for GitHub App runs.
 * 
 * This module provides quota checking functionality based on user subscription plans.
 * The actual implementation requires database access which should be configured
 * based on the current project structure.
 */

import { eq, and, gte, lte } from "drizzle-orm";

/**
 * Quota limits by plan type
 */
export const QUOTA_LIMITS = {
  free: {
    runsPerMonth: 10,
    concurrentRuns: 1,
  },
  pro: {
    runsPerMonth: 100,
    concurrentRuns: 3,
  },
  team: {
    runsPerMonth: 500,
    concurrentRuns: 10,
  },
  enterprise: {
    runsPerMonth: -1, // unlimited
    concurrentRuns: -1, // unlimited
  },
} as const;

export type PlanType = keyof typeof QUOTA_LIMITS;

/**
 * Quota check result
 */
export interface QuotaCheckResult {
  allowed: boolean;
  reason?: string;
  currentUsage: number;
  limit: number;
  plan: PlanType;
}

// Database client type - will be injected by the consumer
let dbClient: any = null;
let runsTable: any = null;
let subscriptionsTable: any = null;
let installationsTable: any = null;

/**
 * Initialize the quota module with database access.
 * This should be called during application startup.
 * 
 * @param deps - Database dependencies
 */
export function initQuotaModule(deps: {
  db: any;
  runs: any;
  subscriptions: any;
  installations: any;
}): void {
  dbClient = deps.db;
  runsTable = deps.runs;
  subscriptionsTable = deps.subscriptions;
  installationsTable = deps.installations;
}

/**
 * Checks if a user has quota available to enqueue a new run.
 * 
 * @param userId - The user's ID
 * @returns QuotaCheckResult indicating if the run is allowed
 */
export async function checkUserQuota(userId: string): Promise<QuotaCheckResult> {
  if (!dbClient || !runsTable || !subscriptionsTable) {
    // If not initialized, return a permissive result (for testing/development)
    console.warn("[quota] Module not initialized, allowing request");
    return {
      allowed: true,
      currentUsage: 0,
      limit: -1,
      plan: "enterprise",
    };
  }

  // Get user's subscription
  const subscription = await dbClient
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.userId, userId))
    .then((rows: any[]) => rows[0]);

  // Default to free plan if no subscription
  const plan: PlanType = subscription?.plan ?? "free";
  const limits = QUOTA_LIMITS[plan];

  // Get current month's usage
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const monthlyRuns = await dbClient
    .select()
    .from(runsTable)
    .where(
      and(
        eq(runsTable.userId, userId),
        gte(runsTable.createdAt, startOfMonth),
        lte(runsTable.createdAt, endOfMonth)
      )
    );

  const currentUsage = monthlyRuns.length;

  // Check monthly limit (unlimited = -1)
  if (limits.runsPerMonth !== -1 && currentUsage >= limits.runsPerMonth) {
    return {
      allowed: false,
      reason: `Monthly run limit reached (${currentUsage}/${limits.runsPerMonth}) for ${plan} plan`,
      currentUsage,
      limit: limits.runsPerMonth,
      plan,
    };
  }

  // Check concurrent runs
  const concurrentRuns = await dbClient
    .select()
    .from(runsTable)
    .where(
      and(
        eq(runsTable.userId, userId),
        eq(runsTable.status, "in_progress")
      )
    );

  const currentConcurrent = concurrentRuns.length;

  if (limits.concurrentRuns !== -1 && currentConcurrent >= limits.concurrentRuns) {
    return {
      allowed: false,
      reason: `Concurrent run limit reached (${currentConcurrent}/${limits.concurrentRuns}) for ${plan} plan`,
      currentUsage,
      limit: limits.runsPerMonth,
      plan,
    };
  }

  return {
    allowed: true,
    currentUsage,
    limit: limits.runsPerMonth,
    plan,
  };
}

/**
 * Checks quota by GitHub installation ID (finds the user from the installation)
 * 
 * @param installationId - The GitHub installation ID
 * @returns QuotaCheckResult indicating if the run is allowed
 */
export async function checkQuotaByInstallation(
  installationId: number
): Promise<QuotaCheckResult> {
  if (!dbClient || !installationsTable || !subscriptionsTable) {
    // If not initialized, return a permissive result (for testing/development)
    console.warn("[quota] Module not initialized, allowing request");
    return {
      allowed: true,
      currentUsage: 0,
      limit: -1,
      plan: "enterprise",
    };
  }

  // Get the user associated with this installation
  const installation = await dbClient
    .select()
    .from(installationsTable)
    .where(eq(installationsTable.githubInstallationId, installationId))
    .then((rows: any[]) => rows[0]);

  if (!installation?.userId) {
    return {
      allowed: false,
      reason: "Installation not found or not associated with a user",
      currentUsage: 0,
      limit: 0,
      plan: "free",
    };
  }

  return checkUserQuota(installation.userId);
}
