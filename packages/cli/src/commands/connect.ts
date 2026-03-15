import { Command } from "commander";
import pc from "picocolors";
import { updateConfig, readConfig, getConfigPath } from "../config.js";

// OAuth Device Flow Configuration
const PRO_API_URL = "https://api.codowave.com";
const OAUTH_DEVICE_CODE_URL = `${PRO_API_URL}/oauth/device/code`;
const OAUTH_TOKEN_URL = `${PRO_API_URL}/oauth/token`;
const OAUTH_CLIENT_ID = "codowave-cli";

// Polling interval in milliseconds
const POLL_INTERVAL = 2000;
// Maximum polling time: 5 minutes
const MAX_POLL_TIME = 5 * 60 * 1000;

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

/**
 * Request a device code from the OAuth server
 */
async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const response = await fetch(OAUTH_DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: OAUTH_CLIENT_ID,
      scope: "read write",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to request device code: ${response.status} ${error}`);
  }

  return response.json() as Promise<DeviceCodeResponse>;
}

interface OAuthError {
  error: string;
  error_description?: string;
}

/**
 * Poll for the access token
 */
async function pollForToken(deviceCode: string): Promise<TokenResponse> {
  const startTime = Date.now();

  while (Date.now() - startTime < MAX_POLL_TIME) {
    const response = await fetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
        client_id: OAUTH_CLIENT_ID,
      }),
    });

    const data = (await response.json()) as TokenResponse | OAuthError;

    if (response.ok) {
      return data as TokenResponse;
    }

    const errorData = data as OAuthError;

    // Check for authorization_pending (user hasn't completed auth yet)
    if (errorData.error === "authorization_pending") {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
      continue;
    }

    // Slow down if we get too many requests
    if (errorData.error === "slow_down") {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL * 2));
      continue;
    }

    // Any other error is fatal
    throw new Error(`Token polling failed: ${errorData.error_description || errorData.error}`);
  }

  throw new Error("Authentication timed out. Please try again.");
}

/**
 * Open the browser for OAuth verification
 */
function openBrowser(url: string): void {
  // Use the open command on macOS/Linux
  const { exec } = require("child_process");
  
  let command: string;
  if (process.platform === "darwin") {
    command = `open "${url}"`;
  } else if (process.platform === "linux") {
    command = `xdg-open "${url}"`;
  } else {
    // Windows or other
    command = `start "" "${url}"`;
  }
  
  exec(command, (error: Error | null) => {
    if (error) {
      console.warn(pc.yellow("⚠ Could not open browser automatically."));
    }
  });
}

export const connectCommand = new Command("connect")
  .description("Upgrade to Codowave Pro via OAuth device flow")
  .action(async () => {
    console.log(pc.cyan("\n═══ Codowave Pro Connect ═══\n"));

    // Check for existing config
    const existingConfig = readConfig();
    if (existingConfig?.apiUrl === PRO_API_URL && existingConfig?.apiKey) {
      console.log(pc.green("✓ You are already connected to Codowave Pro!"));
      console.log(`  Config: ${getConfigPath()}`);
      return;
    }

    try {
      // Step 1: Request device code
      console.log(pc.yellow("Requesting authentication..."));
      const deviceCodeData = await requestDeviceCode();

      // Step 2: Display instructions to user
      console.log(pc.bold("\n⚡ Authentication Required\n"));
      console.log(`  Please visit: ${pc.cyan(deviceCodeData.verification_uri)}`);
      console.log(`  And enter code: ${pc.bold(pc.green(deviceCodeData.user_code))}\n`);
      
      console.log(pc.gray("  (Attempting to open browser automatically...)\n"));

      // Try to open browser
      openBrowser(deviceCodeData.verification_uri_complete);

      // Step 3: Poll for token
      console.log(pc.yellow("Waiting for authentication..."));
      console.log(pc.gray("  Press Ctrl+C to cancel\n"));

      const tokenData = await pollForToken(deviceCodeData.device_code);

      // Step 4: Save the token to config
      const updatedConfig = updateConfig({
        apiKey: tokenData.access_token,
        apiUrl: PRO_API_URL,
      });

      console.log(pc.green("\n✓ Successfully connected to Codowave Pro!"));
      console.log(`\n  Config updated: ${getConfigPath()}`);
      console.log(`  API URL: ${pc.cyan(updatedConfig.apiUrl)}`);
      console.log(pc.gray("\n  You can now use all Pro features!"));

    } catch (error) {
      console.error(pc.red(`\n✖ Connection failed: ${error instanceof Error ? error.message : String(error)}\n`));
      process.exit(1);
    }
  });
