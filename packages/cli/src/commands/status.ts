import { Command } from "commander";
import pc from "picocolors";
import { readConfig, getConfigPath } from "../config.js";
import { handleError } from "../utils/error.js";
import { getRun, getLatestRun, checkConnection, type Run } from "../api/client.js";

function formatStatus(status: string): string {
  const colors: Record<string, (s: string) => string> = {
    queued: pc.gray,
    planning: pc.blue,
    awaiting_plan_approval: pc.yellow,
    coding: pc.blue,
    testing: pc.cyan,
    pr_open: pc.cyan,
    awaiting_merge_approval: pc.yellow,
    merged: pc.green,
    failed: pc.red,
    cancelled: pc.gray,
  };

  const colorFn = colors[status] || pc.white;
  return colorFn(status.replace(/_/g, " "));
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString();
}

function displayRunDetails(run: Run): void {
  console.log(`\n${pc.bold("Run Details:")}`);
  console.log(`  ${pc.gray("ID:")}         ${run.id}`);
  console.log(`  ${pc.gray("Repository:")} ${run.repoFullName}`);
  console.log(`  ${pc.gray("Issue:")}      #${run.issueNumber}`);
  console.log(`  ${pc.gray("Status:")}     ${formatStatus(run.status)}`);
  console.log(`  ${pc.gray("Started:")}    ${formatDate(run.startedAt)}`);

  if (run.completedAt) {
    console.log(`  ${pc.gray("Completed:")}  ${formatDate(run.completedAt)}`);
  }

  if (run.prNumber) {
    console.log(`  ${pc.gray("PR:")}        #${run.prNumber} (${run.prUrl})`);
  }

  if (run.retryCount > 0) {
    console.log(`  ${pc.gray("Retries:")}   ${run.retryCount}`);
  }

  // Show current step based on status
  if (run.status === "planning" || run.status === "awaiting_plan_approval") {
    if (run.plan) {
      console.log(`\n${pc.bold("Plan:")}`);
      console.log(`  ${run.plan.approach}`);
      console.log(`\n${pc.bold("Steps:")}`);
      run.plan.steps.forEach((step, i) => {
        console.log(`  ${i + 1}. ${step.description}`);
      });
    }
  } else if (run.status === "coding") {
    console.log(`\n${pc.bold("Current:")} Writing code...`);
  } else if (run.status === "testing") {
    console.log(`\n${pc.bold("Current:")} Running tests...`);
  }
}

export const statusCommand = new Command("status")
  .description("Show the status of a Codowave run")
  .option("-r, --repo <owner/repo>", "Filter by repository")
  .option("--connection", "Show connection status only")
  .argument("[run-id]", "Run ID (defaults to latest)")
  .action(async (runId: string | undefined, options: { repo?: string; connection?: boolean }) => {
    try {
      // Show connection status only
      if (options.connection) {
        const config = readConfig();
        console.log(`${pc.bold("Configuration:")}`);
        console.log(`  ${pc.gray("API URL:")}   ${config?.apiUrl || "Not set"}`);
        console.log(`  ${pc.gray("Config:")}   ${getConfigPath()}`);

        console.log(`\n${pc.bold("Connection:")}`);
        const conn = await checkConnection();
        if (conn.connected) {
          console.log(`  ${pc.green("✓")} Connected to API`);
        } else {
          console.log(`  ${pc.red("✖")} Not connected: ${conn.error}`);
        }
        return;
      }

      // Get the run to display
      let run: Run | null;

      if (runId) {
        run = await getRun(runId);
        if (!run) {
          handleError(`Run not found: ${runId}`);
        }
      } else {
        run = await getLatestRun(options.repo);
        if (!run) {
          console.log(pc.yellow("No runs found."));
          if (options.repo) {
            console.log(pc.gray(`  Try running without the --repo filter, or trigger a new run with \`codowave run <issue>\``));
          } else {
            console.log(pc.gray("  Trigger a new run with `codowave run <issue>`"));
          }
          return;
        }
      }

      displayRunDetails(run);
    } catch (err) {
      handleError(err, "status");
    }
  });
