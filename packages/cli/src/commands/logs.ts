import { Command } from "commander";
import pc from "picocolors";
import { handleError } from "../utils/error.js";
import { getRunLogs, getLatestRun, type LogEntry } from "../api/client.js";

function formatLogLevel(level: string): (s: string) => string {
  const colors: Record<string, (s: string) => string> = {
    info: pc.blue,
    warn: pc.yellow,
    error: pc.red,
    debug: pc.gray,
  };
  return colors[level] || pc.white;
}

function formatLogEntry(entry: LogEntry, showTimestamp: boolean): void {
  const colorFn = formatLogLevel(entry.level);
  const levelStr = colorFn(entry.level.toUpperCase().padEnd(5));
  const timestamp = showTimestamp
    ? pc.gray(new Date(entry.timestamp).toLocaleTimeString() + " ")
    : "";
  const sourceStr = entry.source ? pc.gray(`[${entry.source}] `) : "";

  console.log(`${timestamp}${levelStr} ${sourceStr}${entry.message}`);
}

export const logsCommand = new Command("logs")
  .description("Show logs for a Codowave run")
  .argument("[run-id]", "Run ID (defaults to latest)")
  .option("-f, --follow", "Follow log output (stream in real-time)")
  .option("-l, --level <level>", "Filter by log level (info, warn, error, debug)")
  .option("-n, --lines <number>", "Number of lines to show (default: 50)", "50")
  .option("--no-timestamp", "Hide timestamps")
  .option("-r, --repo <owner/repo>", "Get latest run for repository")
  .action(
    async (
      runId: string | undefined,
      options: {
        follow?: boolean;
        level?: string;
        lines?: string;
        timestamp?: boolean;
        repo?: string;
      }
    ) => {
      try {
        // Get run ID if not provided
        let targetRunId = runId;

        if (!targetRunId) {
          const latestRun = await getLatestRun(options.repo);
          if (!latestRun) {
            console.log(pc.yellow("No runs found."));
            if (options.repo) {
              console.log(
                pc.gray(
                  `  Try running without the --repo filter, or trigger a new run with \`codowave run <issue>\``
                )
              );
            } else {
              console.log(pc.gray("  Trigger a new run with `codowave run <issue>`"));
            }
            return;
          }
          targetRunId = latestRun.id;
          console.log(pc.gray(`Showing logs for latest run: ${targetRunId}\n`));
        }

        // Validate level filter
        const validLevels = ["info", "warn", "error", "debug"];
        const levelInput = options.level?.toLowerCase();
        if (levelInput && !validLevels.includes(levelInput)) {
          handleError(`Invalid log level: ${options.level}. Valid: ${validLevels.join(", ")}`);
        }

        const limit = parseInt(options.lines || "50", 10);
        if (isNaN(limit) || limit < 1) {
          handleError("Invalid --lines value. Must be a positive number.");
        }

        // Prepare filter options (only include defined values)
        const logOptions: {
          level?: "info" | "warn" | "error" | "debug";
          limit: number;
        } = { limit };
        if (levelInput && validLevels.includes(levelInput)) {
          logOptions.level = levelInput as "info" | "warn" | "error" | "debug";
        }

        // Handle follow mode (streaming)
        if (options.follow) {
          console.log(pc.cyan("Following logs... (Ctrl+C to exit)\n"));

          // For now, we'll poll for logs (SSE would require more setup)
          // In production, this would connect to an SSE endpoint
          let lastLogId: string | undefined;

          while (true) {
            const logs = await getRunLogs(targetRunId, {
              ...logOptions,
              limit: 20,
            });

            // Show only new logs
            const newLogs = lastLogId
              ? logs.filter((log) => log.id !== lastLogId)
              : logs.slice(-20);

            for (const log of newLogs) {
              formatLogEntry(log, options.timestamp !== false);
            }

            if (newLogs.length > 0) {
              const lastEntry = newLogs[newLogs.length - 1];
              lastLogId = lastEntry?.id;
            }

            // Wait before polling again
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        }

        // Normal mode: fetch and display logs
        const logs = await getRunLogs(targetRunId, logOptions);

        if (logs.length === 0) {
          console.log(pc.yellow("No logs found for this run."));
          return;
        }

        // Show logs (newest first by default, but let's show oldest first for readability)
        const sortedLogs = [...logs].sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );

        for (const log of sortedLogs) {
          formatLogEntry(log, options.timestamp !== false);
        }

        console.log(pc.gray(`\nShowing ${logs.length} log entries.`));
      } catch (err) {
        handleError(err, "logs");
      }
    }
  );
