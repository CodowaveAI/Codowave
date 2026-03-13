import { Command } from "commander";
import pc from "picocolors";

export const statusCommand = new Command("status")
  .description("Show the status of a Codowave run")
  .argument("[run-id]", "Run ID (defaults to latest)")
  .action(async (runId?: string) => {
    console.log(pc.yellow("status command — full implementation in Task 5.3"));
  });
