import { Command } from "commander";
import pc from "picocolors";

export const runCommand = new Command("run")
  .description("Trigger Codowave to process a GitHub issue")
  .argument("<issue>", "GitHub issue number or URL")
  .option("-r, --repo <owner/repo>", "Target repository (e.g. org/repo)")
  .action(async (issue: string, options: { repo?: string }) => {
    console.log(pc.yellow("run command — full implementation in Task 5.3"));
  });
