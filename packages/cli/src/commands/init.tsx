import { Command } from "commander";

export const initCommand = new Command("init")
  .description("Initialize Codowave and connect your GitHub repositories")
  .action(async () => {
    // Full implementation in Task 5.2
    const { render } = await import("ink");
    const { default: React } = await import("react");

    // Stub: just print a message until Task 5.2
    const { Text } = await import("ink");
    const { waitUntilExit } = render(
      React.createElement(Text, null, "init wizard coming in Task 5.2")
    );
    await waitUntilExit();
  });
