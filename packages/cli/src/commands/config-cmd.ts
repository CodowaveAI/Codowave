import { Command } from "commander";
import pc from "picocolors";
import { readConfig, readConfigOrThrow, updateConfig, getConfigPath } from "../config.js";

export const configCommand = new Command("config")
  .description("Get or set Codowave configuration values");

// List all available config options
configCommand
  .command("list")
  .description("List all available config options")
  .action(() => {
    console.log(pc.bold("\n📋 Available Config Options:\n"));
    console.log(`  ${pc.cyan("apiKey")}       ${pc.gray("— Your Codowave API key")}`);
    console.log(`  ${pc.cyan("apiUrl")}       ${pc.gray("— API endpoint URL (default: https://api.codowave.com)")}`);
    console.log(`  ${pc.cyan("repos")}        ${pc.gray("— List of configured repositories")}`);
    console.log(`  ${pc.cyan("configPath")}   ${pc.gray("— Path to the config file")}`);
    console.log("");
  });

// Get a config value
configCommand
  .command("get <key>")
  .description("Get a config value")
  .action((key: string) => {
    try {
      const config = readConfigOrThrow();
      
      // Special case for configPath
      if (key === "configPath") {
        console.log(pc.green(getConfigPath()));
        return;
      }
      
      // Special case for repos - show nicely formatted
      if (key === "repos") {
        if (config.repos.length === 0) {
          console.log(pc.yellow("No repos configured."));
        } else {
          console.log(pc.bold("\n📦 Configured Repositories:\n"));
          config.repos.forEach((repo, index) => {
            console.log(`  ${index + 1}. ${pc.cyan(`${repo.owner}/${repo.name}`)}`);
            if (repo.id) {
              console.log(`     ${pc.gray("ID: " + repo.id)}`);
            }
          });
          console.log("");
        }
        return;
      }
      
      // Get a specific key
      const value = config[key as keyof typeof config];
      
      if (value === undefined) {
        console.error(pc.red(`✖ Unknown config key: ${key}`));
        console.log(pc.gray(`  Run \`codowave config list\` to see available options.`));
        process.exit(1);
      }
      
      console.log(value);
    } catch (err) {
      console.error(pc.red(`✖ ${err instanceof Error ? err.message : String(err)}`));
      process.exit(1);
    }
  });

// Set a config value
configCommand
  .command("set <key> <value>")
  .description("Set a config value")
  .action((key: string, value: string) => {
    try {
      // Validate the key
      const validKeys = ["apiKey", "apiUrl"];
      if (!validKeys.includes(key)) {
        console.error(pc.red(`✖ Cannot set '${key}' directly.`));
        console.log(pc.gray(`  For 'repos', use \`codowave init\` to manage repositories.`));
        console.log(pc.gray(`  Run \`codowave config list\` to see available options.`));
        process.exit(1);
      }
      
      // Validate apiUrl if provided
      if (key === "apiUrl") {
        try {
          new URL(value);
        } catch {
          console.error(pc.red(`✖ Invalid URL: ${value}`));
          process.exit(1);
        }
      }
      
      const updates = { [key]: value };
      const newConfig = updateConfig(updates);
      
      console.log(pc.green(`✓ Updated ${key}`));
      
      // Show the new value
      console.log(pc.gray(`  ${key} = ${newConfig[key as keyof typeof newConfig]}`));
    } catch (err) {
      console.error(pc.red(`✖ ${err instanceof Error ? err.message : String(err)}`));
      process.exit(1);
    }
  });

// Show all current config values (alias for showing full config)
configCommand
  .command("show")
  .description("Show all current config values")
  .action(() => {
    try {
      const config = readConfigOrThrow();
      
      console.log(pc.bold("\n⚙️  Current Configuration:\n"));
      console.log(`  ${pc.cyan("apiKey")}:       ${config.apiKey ? pc.green("••••••••") + pc.gray(" (hidden)") : pc.yellow("not set")}`);
      console.log(`  ${pc.cyan("apiUrl")}:       ${config.apiUrl}`);
      console.log(`  ${pc.cyan("repos")}:        ${config.repos.length} repository(s) configured`);
      console.log(`  ${pc.cyan("configPath")}:  ${pc.gray(getConfigPath())}`);
      
      if (config.repos.length > 0) {
        console.log(pc.bold(pc.gray("\n  Repositories:")));
        config.repos.forEach((repo) => {
          console.log(`    • ${repo.owner}/${repo.name}${repo.id ? pc.gray(` (${repo.id})`) : ""}`);
        });
      }
      
      console.log("");
    } catch (err) {
      console.error(pc.red(`✖ ${err instanceof Error ? err.message : String(err)}`));
      process.exit(1);
    }
  });

// Default action when just 'config' is run - show help
configCommand.action(() => {
  configCommand.help();
});
