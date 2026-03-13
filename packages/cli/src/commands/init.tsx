import { Command } from "commander";

export const initCommand = new Command("init")
  .description("Initialize Codowave and connect your GitHub repositories")
  .action(async () => {
    // TODO: Task 5.2 — full init wizard implementation
    const { render, Text } = await import("ink");
    const { default: React } = await import("react");

    const { waitUntilExit } = render(
      React.createElement(Text, null, "init wizard coming in Task 5.2")
    );
    await waitUntilExit();
  });
