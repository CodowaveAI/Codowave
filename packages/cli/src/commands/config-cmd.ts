import { Command } from "commander";
import pc from "picocolors";

export const configCommand = new Command("config")
  .description("Get or set Codowave configuration values");

configCommand
  .command("get <key>")
  .description("Get a config value")
  .action((key: string) => {
    console.log(pc.yellow("config get — full implementation in Task 5.3"));
  });

configCommand
  .command("set <key> <value>")
  .description("Set a config value")
  .action((key: string, value: string) => {
    console.log(pc.yellow("config set — full implementation in Task 5.3"));
  });

configCommand
  .command("show")
  .description("Show all current config values")
  .action(() => {
    console.log(pc.yellow("config show — full implementation in Task 5.3"));
  });
