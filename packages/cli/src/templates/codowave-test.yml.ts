/**
 * Codowave Test Workflow Template
 * Generates a GitHub Actions workflow YAML file for running tests
 * and reporting results back to the Codowave API.
 */

export interface WorkflowOptions {
	/** The GitHub repository owner */
	owner: string;
	/** The GitHub repository name */
	repo: string;
	/** The Codowave API URL */
	apiUrl: string;
	/** The Codowave API key */
	apiKey: string;
	/** Node.js version to use */
	nodeVersion?: string;
	/** Package manager to use (pnpm, npm, yarn) */
	packageManager?: "pnpm" | "npm" | "yarn";
}

export function generateWorkflowYaml(options: WorkflowOptions): string {
	const {
		owner,
		repo,
		apiUrl,
		apiKey,
		nodeVersion = "20",
		packageManager = "pnpm",
	} = options;

	// Package manager install commands
	const installCommands: Record<string, string> = {
		pnpm: "pnpm install",
		npm: "npm install",
		yarn: "yarn install",
	};

	// Package manager test commands
	const testCommands: Record<string, string> = {
		pnpm: "pnpm test",
		npm: "npm test",
		yarn: "yarn test",
	};

	const installCmd = installCommands[packageManager] || installCommands.pnpm;
	const testCmd = testCommands[packageManager] || testCommands.pnpm;

	return `name: Codowave Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    name: Run Tests
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "${nodeVersion}"
          cache: "${packageManager}"

      - name: Install dependencies
        run: ${installCmd}

      - name: Run tests
        id: test
        run: ${testCmd}
        continue-on-error: true

      - name: Report results to Codowave
        if: always()
        run: |
          # Determine test status
          if [ "\${{ steps.test.outcome }}" == "success" ]; then
            STATUS="success"
          else
            STATUS="failure"
          fi

          # Send test results to Codowave API
          curl -X POST "${apiUrl}/api/v1/runs/github" \\
            -H "Authorization: Bearer ${apiKey}" \\
            -H "Content-Type: application/json" \\
            -d '{
              "owner": "${owner}",
              "repo": "${repo}",
              "workflow": "codowave-test",
              "status": "'"$STATUS"'",
              "branch": "\${{ github.ref_name }}",
              "commit": "\${{ github.sha }}",
              "run_id": \${{ github.run_id }},
              "run_number": \${{ github.run_number }}
            }'
        env:
          API_URL: ${apiUrl}
          API_KEY: ${apiKey}
`.trim();
}
