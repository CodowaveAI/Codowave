#!/usr/bin/env node
import { Command } from "commander";
import pc from "picocolors";
import { readConfig } from "./config.js";

// Dynamically imported to keep startup fast
const { initCommand } = await import("./commands/init.js");
const { runCommand } = await import("./commands/run.js");
const { statusCommand } = await import("./commands/status.js");
const { logsCommand } = await import("./commands/logs.js");
const { configCommand } = await import("./commands/config-cmd.js");
const { connectCommand } = await import("./commands/connect.js");

const VERSION = "0.1.0";

const program = new Command();

program
  .name("codowave")
  .description(
    pc.bold("Codowave") +
      " — AI-powered coding agent for your GitHub repositories"
  )
  .version(VERSION, "-v, --version", "Output the current version")
  .helpOption("-h, --help", "Display help")
  .addHelpText(
    "beforeAll",
    `\n${pc.cyan("  ██████╗ ██████╗ ██████╗  ██████╗ ██╗    ██╗ █████╗ ██╗   ██╗███████╗")}\n${pc.cyan("  ██╔════╝██╔═══██╗██╔══██╗██╔═══██╗██║    ██║██╔══██╗██║   ██║██╔════╝")}\n${pc.cyan("  ██║     ██║   ██║██║  ██║██║   ██║██║ █╗ ██║███████║██║   ██║█████╗  ")}\n${pc.cyan("  ╚██████╗╚██████╔╝██████╔╝╚██████╔╝╚███╔███╔╝██║  ██║╚██████╔╝███████╗")}\n`
  )
  // Global option: override API URL (useful for self-hosted deployments)
  .option("--api-url <url>", "Override the Codowave API URL");

// ── Subcommands ────────────────────────────────────────────────────────────

program.addCommand(initCommand);
program.addCommand(runCommand);
program.addCommand(statusCommand);
program.addCommand(logsCommand);
program.addCommand(configCommand);
program.addCommand(connectCommand);

// ── Global error handler ───────────────────────────────────────────────────

program.configureOutput({
  writeErr: (str) => process.stderr.write(pc.red(str)),
});

// Show warning if not initialized (except for init and help)
const args = process.argv.slice(2);
const isInitOrHelp =
  args[0] === "init" ||
  args[0] === "connect" ||
  args.includes("--help") ||
  args.includes("-h") ||
  args.includes("--version") ||
  args.includes("-v") ||
  args.length === 0;

if (!isInitOrHelp) {
  const config = readConfig();
  if (!config) {
    console.warn(
      pc.yellow(
        "⚠  No config found. Run " +
          pc.bold("codowave init") +
          " to get started.\n"
      )
    );
  }
}

// ── Parse ──────────────────────────────────────────────────────────────────

program.parseAsync(process.argv).catch((err) => {
  console.error(pc.red(`\n✖ Error: ${err instanceof Error ? err.message : String(err)}\n`));
  process.exit(1);
});
