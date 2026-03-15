import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  uuid,
  jsonb,
  pgEnum,
  index,
} from 'drizzle-orm/pg-core';

// Enums
export const runStatusEnum = pgEnum('run_status', [
  'pending',
  'in_progress',
  'completed',
  'failed',
  'cancelled',
]);

export const runStageStatusEnum = pgEnum('run_stage_status', [
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
]);

export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'active',
  'cancelled',
  'past_due',
  'trialing',
]);

export const planTypeEnum = pgEnum('plan_type', [
  'free',
  'pro',
  'team',
  'enterprise',
]);

// Users table
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  githubId: text('github_id').unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Sessions table (for authentication)
export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index('idx_sessions_user_id').on(table.userId),
  tokenIdx: index('idx_sessions_token').on(table.token),
}));

// Accounts table (OAuth provider accounts)
export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  provider: text('provider').notNull(),
  providerAccountId: text('provider_account_id').notNull(),
  refreshToken: text('refresh_token'),
  accessToken: text('access_token'),
  expiresAt: integer('expires_at'),
  tokenType: text('token_type'),
  scope: text('scope'),
  idToken: text('id_token'),
  sessionState: text('session_state'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  providerIdx: index('idx_accounts_provider').on(table.provider, table.providerAccountId),
  userIdIdx: index('idx_accounts_user_id').on(table.userId),
}));

// GitHub Installations table
export const installations = pgTable('installations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  githubInstallationId: integer('github_installation_id').notNull().unique(),
  githubAccountId: integer('github_account_id').notNull(),
  githubAccountLogin: text('github_account_login').notNull(),
  githubAccountType: text('github_account_type').notNull(),
  repositorySelection: text('repository_selection').notNull(),
  installedRepos: jsonb('installed_repos').$type<string[]>(),
  permissions: jsonb('permissions').$type<Record<string, string>>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index('idx_installations_user_id').on(table.userId),
}));

// Repositories table
export const repositories = pgTable('repositories', {
  id: uuid('id').primaryKey().defaultRandom(),
  installationId: uuid('installation_id')
    .notNull()
    .references(() => installations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  githubRepoId: integer('github_repo_id').notNull().unique(),
  name: text('name').notNull(),
  fullName: text('full_name').notNull(),
  private: boolean('private').notNull().default(false),
  defaultBranch: text('default_branch').notNull().default('main'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  installationIdIdx: index('idx_repositories_installation_id').on(table.installationId),
  userIdIdx: index('idx_repositories_user_id').on(table.userId),
}));

// Runs table
export const runs = pgTable('runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  repositoryId: uuid('repository_id')
    .notNull()
    .references(() => repositories.id, { onDelete: 'cascade' }),
  installationId: uuid('installation_id').references(() => installations.id, { onDelete: 'set null' }),
  githubRunId: integer('github_run_id'),
  prNumber: integer('pr_number'),
  prTitle: text('pr_title'),
  prBody: text('pr_body'),
  branchName: text('branch_name'),
  baseBranch: text('base_branch'),
  commitSha: text('commit_sha'),
  status: runStatusEnum('status').notNull().default('pending'),
  errorMessage: text('error_message'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index('idx_runs_user_id').on(table.userId),
  repositoryIdIdx: index('idx_runs_repository_id').on(table.repositoryId),
  statusIdx: index('idx_runs_status').on(table.status),
  githubRunIdIdx: index('idx_runs_github_run_id').on(table.githubRunId),
}));

// Run Stages table
export const runStages = pgTable('run_stages', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id')
    .notNull()
    .references(() => runs.id, { onDelete: 'cascade' }),
  stageName: text('stage_name').notNull(),
  status: runStageStatusEnum('status').notNull().default('pending'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  errorMessage: text('error_message'),
  logs: text('logs'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  runIdIdx: index('idx_run_stages_run_id').on(table.runId),
  statusIdx: index('idx_run_stages_status').on(table.status),
}));

// Test Results table
export const testResults = pgTable('test_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id')
    .notNull()
    .references(() => runs.id, { onDelete: 'cascade' }),
  runStageId: uuid('run_stage_id').references(() => runStages.id, { onDelete: 'set null' }),
  testName: text('test_name').notNull(),
  testFile: text('test_file'),
  status: text('status').notNull(),
  duration: integer('duration'),
  errorMessage: text('error_message'),
  errorStack: text('error_stack'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  runIdIdx: index('idx_test_results_run_id').on(table.runId),
  runStageIdIdx: index('idx_test_results_run_stage_id').on(table.runStageId),
}));

// Cron Runs table
export const cronRuns = pgTable('cron_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  repositoryId: uuid('repository_id')
    .notNull()
    .references(() => repositories.id, { onDelete: 'cascade' }),
  cronExpression: text('cron_expression').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  lastRunAt: timestamp('last_run_at'),
  nextRunAt: timestamp('next_run_at'),
  lastRunStatus: text('last_run_status'),
  lastRunError: text('last_run_error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index('idx_cron_runs_user_id').on(table.userId),
  repositoryIdIdx: index('idx_cron_runs_repository_id').on(table.repositoryId),
  enabledIdx: index('idx_cron_runs_enabled').on(table.enabled),
}));

// Subscriptions table
export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  stripeCustomerId: text('stripe_customer_id').unique(),
  stripeSubscriptionId: text('stripe_subscription_id').unique(),
  status: subscriptionStatusEnum('status').notNull(),
  plan: planTypeEnum('plan').notNull().default('free'),
  currentPeriodStart: timestamp('current_period_start'),
  currentPeriodEnd: timestamp('current_period_end'),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index('idx_subscriptions_user_id').on(table.userId),
  statusIdx: index('idx_subscriptions_status').on(table.status),
  stripeCustomerIdIdx: index('idx_subscriptions_stripe_customer_id').on(table.stripeCustomerId),
}));

// Type exports
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Installation = typeof installations.$inferSelect;
export type NewInstallation = typeof installations.$inferInsert;
export type Repository = typeof repositories.$inferSelect;
export type NewRepository = typeof repositories.$inferInsert;
export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;
export type RunStage = typeof runStages.$inferSelect;
export type NewRunStage = typeof runStages.$inferInsert;
export type TestResult = typeof testResults.$inferSelect;
export type NewTestResult = typeof testResults.$inferInsert;
export type CronRun = typeof cronRuns.$inferSelect;
export type NewCronRun = typeof cronRuns.$inferInsert;
export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
