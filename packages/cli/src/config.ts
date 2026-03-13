import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { z } from "zod";

// ── Schema ─────────────────────────────────────────────────────────────────

export const ConfigSchema = z.object({
  apiKey: z.string().min(1),
  apiUrl: z.string().url().default("https://api.codowave.com"),
  repos: z
    .array(
      z.object({
        owner: z.string(),
        name: z.string(),
        id: z.string().optional(),
      })
    )
    .default([]),
});

export type CodowaveConfig = z.infer<typeof ConfigSchema>;

// ── Paths ──────────────────────────────────────────────────────────────────

const CONFIG_DIR = join(homedir(), ".codowave");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

// ── Read ───────────────────────────────────────────────────────────────────

export function readConfig(): CodowaveConfig | null {
  if (!existsSync(CONFIG_FILE)) {
    return null;
  }

  try {
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    const json = JSON.parse(raw);
    const parsed = ConfigSchema.safeParse(json);

    if (!parsed.success) {
      return null;
    }

    return parsed.data;
  } catch {
    return null;
  }
}

export function readConfigOrThrow(): CodowaveConfig {
  const config = readConfig();
  if (!config) {
    throw new Error(
      `No Codowave config found. Run \`codowave init\` to get started.`
    );
  }
  return config;
}

// ── Write ──────────────────────────────────────────────────────────────────

export function writeConfig(config: CodowaveConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

export function updateConfig(
  updates: Partial<CodowaveConfig>
): CodowaveConfig {
  const current = readConfig() ?? {
    apiKey: "",
    apiUrl: "https://api.codowave.com",
    repos: [],
  };

  const merged: CodowaveConfig = {
    ...current,
    ...updates,
  };

  writeConfig(merged);
  return merged;
}

// ── Config path getter (for display) ──────────────────────────────────────

export function getConfigPath(): string {
  return CONFIG_FILE;
}
