import pc from "picocolors";

export function handleError(err: unknown, context?: string): never {
  const message = err instanceof Error ? err.message : String(err);
  const prefix = context ? `[${context}] ` : "";
  console.error(`\n${pc.red("✖")} ${prefix}${message}\n`);
  process.exit(1);
}

export function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
