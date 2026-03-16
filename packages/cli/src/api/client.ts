import { readConfigOrThrow } from "../config.js";
import { formatError } from "../utils/error.js";

// Base API client for making requests to the Codowave backend

interface ApiResponse<T> {
  data?: T;
  error?: string;
}

async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const config = readConfigOrThrow();
  const url = `${config.apiUrl}${endpoint}`;

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return {
        error: `API error (${response.status}): ${errorBody || response.statusText}`,
      };
    }

    const data = await response.json() as T;
    return { data };
  } catch (err) {
    return { error: formatError(err) };
  }
}

// Types matching the core package
export type RunStatus =
  | "queued"
  | "planning"
  | "awaiting_plan_approval"
  | "coding"
  | "testing"
  | "pr_open"
  | "awaiting_merge_approval"
  | "merged"
  | "failed"
  | "cancelled";

export interface Run {
  id: string;
  repoFullName: string;
  issueNumber: number;
  status: RunStatus;
  plan?: {
    approach: string;
    steps: { description: string; filesToModify: string[] }[];
    filesToModify: string[];
  };
  patch?: {
    diff: string;
    branch: string;
    commitMessage: string;
  };
  prNumber?: number;
  prUrl?: string;
  retryCount: number;
  startedAt: string;
  completedAt?: string;
}

export interface LogEntry {
  id: string;
  runId: string;
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  source?: string;
}

export interface RunListResponse {
  runs: Run[];
  total: number;
}

export interface LogsResponse {
  logs: LogEntry[];
  total: number;
}

// API functions

/**
 * Get all runs, optionally filtered by repo or status
 */
export async function getRuns(options?: {
  repo?: string;
  status?: RunStatus;
  limit?: number;
}): Promise<Run[]> {
  const params = new URLSearchParams();
  if (options?.repo) params.set("repo", options.repo);
  if (options?.status) params.set("status", options.status);
  if (options?.limit) params.set("limit", String(options.limit));

  const query = params.toString();
  const endpoint = `/api/v1/runs${query ? `?${query}` : ""}`;

  const result = await apiRequest<RunListResponse>(endpoint);
  if (result.error) {
    throw new Error(`Failed to fetch runs: ${result.error}`);
  }
  return result.data?.runs ?? [];
}

/**
 * Get a specific run by ID
 */
export async function getRun(runId: string): Promise<Run | null> {
  const result = await apiRequest<Run>(`/api/v1/runs/${runId}`);
  if (result.error) {
    throw new Error(`Failed to fetch run: ${result.error}`);
  }
  return result.data ?? null;
}

/**
 * Get the latest run, optionally filtered by repo
 */
export async function getLatestRun(repo?: string): Promise<Run | null> {
  const params = new URLSearchParams();
  if (repo) params.set("repo", repo);
  params.set("limit", "1");

  const query = params.toString();
  const result = await apiRequest<RunListResponse>(`/api/v1/runs?${query}`);
  if (result.error) {
    throw new Error(`Failed to fetch latest run: ${result.error}`);
  }
  return result.data?.runs?.[0] ?? null;
}

/**
 * Get logs for a specific run
 */
export async function getRunLogs(
  runId: string,
  options?: {
    level?: "info" | "warn" | "error" | "debug";
    limit?: number;
    since?: string;
  }
): Promise<LogEntry[]> {
  const params = new URLSearchParams();
  if (options?.level) params.set("level", options.level);
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.since) params.set("since", options.since);

  const query = params.toString();
  const endpoint = `/api/v1/runs/${runId}/logs${query ? `?${query}` : ""}`;

  const result = await apiRequest<LogsResponse>(endpoint);
  if (result.error) {
    throw new Error(`Failed to fetch logs: ${result.error}`);
  }
  return result.data?.logs ?? [];
}

/**
 * Check if the API is reachable and credentials are valid
 */
export async function checkConnection(): Promise<{
  connected: boolean;
  error?: string;
}> {
  try {
    const config = readConfigOrThrow();
    const response = await fetch(`${config.apiUrl}/api/v1/health`, {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
    });

    if (response.ok) {
      return { connected: true };
    }

    return {
      connected: false,
      error: `API returned status ${response.status}`,
    };
  } catch (err) {
    return {
      connected: false,
      error: formatError(err),
    };
  }
}
