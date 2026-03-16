import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import pc from "picocolors";
import { Octokit } from "octokit";

/**
 * Workflow generation options
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

/**
 * Generates a GitHub Actions workflow YAML for running tests
 * and reporting results back to the Codowave API.
 */
function generateWorkflowYaml(options: WorkflowOptions): string {
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

type Repo = {
	owner: string;
	name: string;
	id?: string;
};

type Props = {
	apiUrl: string;
	apiKey: string;
	repos: Repo[];
	onComplete: () => void;
	onSkip: () => void;
	onCancel: () => void;
};

type Step = "prompt" | "select-repo" | "enter-token" | "creating" | "success" | "error";

export const WorkflowStep: React.FC<Props> = ({
	apiUrl,
	apiKey,
	repos,
	onComplete,
	onSkip,
	onCancel,
}) => {
	const [step, setStep] = useState<Step>("prompt");
	const [selectedRepoIndex, setSelectedRepoIndex] = useState(0);
	const [githubToken, setGithubToken] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [actionsUrl, setActionsUrl] = useState<string | null>(null);

	function handlePromptConfirm(confirm: boolean) {
		if (confirm) {
			if (repos.length === 1) {
				// Skip repo selection if only one repo
				setStep("enter-token");
			} else {
				setStep("select-repo");
			}
		} else {
			onSkip();
		}
	}

	function handleRepoSelect() {
		setStep("enter-token");
	}

	function handleTokenSubmit() {
		if (!githubToken.trim()) {
			setError("GitHub token cannot be empty");
			return;
		}
		setError(null);
		setStep("creating");
		createWorkflow();
	}

	async function createWorkflow() {
		const selectedRepo = repos[selectedRepoIndex]!;
		
		try {
			// Initialize Octokit with the GitHub token
			const octokit = new Octokit({ auth: githubToken });

			// Get the repository to verify access
			const { data: repo } = await octokit.rest.repos.get({
				owner: selectedRepo.owner,
				repo: selectedRepo.name,
			});

			// Generate the workflow YAML
			const workflowOptions: WorkflowOptions = {
				owner: selectedRepo.owner,
				repo: selectedRepo.name,
				apiUrl: apiUrl,
				apiKey: apiKey,
			};

			const workflowContent = generateWorkflowYaml(workflowOptions);
			const workflowPath = ".github/workflows/codowave-test.yml";

			// Check if .github directory exists, create if not
			try {
				await octokit.rest.repos.getContent({
					owner: selectedRepo.owner,
					repo: selectedRepo.name,
					path: ".github",
				});
			} catch {
				// Create .github directory
				await octokit.rest.repos.createOrUpdateFileContents({
					owner: selectedRepo.owner,
					repo: selectedRepo.name,
					path: ".github/",
					message: "Create .github directory for Codowave workflows",
					content: Buffer.from("").toString("base64"),
				});
			}

			// Check if workflows directory exists
			try {
				await octokit.rest.repos.getContent({
					owner: selectedRepo.owner,
					repo: selectedRepo.name,
					path: ".github/workflows",
				});
			} catch {
				// Create workflows directory
				await octokit.rest.repos.createOrUpdateFileContents({
					owner: selectedRepo.owner,
					repo: selectedRepo.name,
					path: ".github/workflows/",
					message: "Create workflows directory for Codowave",
					content: Buffer.from("").toString("base64"),
				});
			}

			// Check if workflow file already exists
			let sha: string | undefined;
			try {
				const existing = await octokit.rest.repos.getContent({
					owner: selectedRepo.owner,
					repo: selectedRepo.name,
					path: workflowPath,
				});
				if (!Array.isArray(existing.data) && existing.data.type === "file") {
					sha = existing.data.sha;
				}
			} catch {
				// File doesn't exist, that's fine
			}

			// Create or update the workflow file
			const commitMessage = sha
				? "Update Codowave test workflow"
				: "Add Codowave test workflow";

			const fileContentsParams = {
				owner: selectedRepo.owner,
				repo: selectedRepo.name,
				path: workflowPath,
				message: commitMessage,
				content: Buffer.from(workflowContent).toString("base64"),
				...(sha && { sha }), // Include SHA only if updating existing file
			};

			await octokit.rest.repos.createOrUpdateFileContents(fileContentsParams);

			// Generate the Actions URL
			const actionsUrl = `https://github.com/${selectedRepo.owner}/${selectedRepo.name}/actions`;
			setActionsUrl(actionsUrl);
			setStep("success");
		} catch (err) {
			const message = err instanceof Error ? err.message : "Failed to create workflow";
			setError(message);
			setStep("error");
		}
	}

	function handleComplete() {
		onComplete();
	}

	function handleGoBack() {
		setError(null);
		if (step === "select-repo") {
			setStep("prompt");
		} else if (step === "enter-token") {
			if (repos.length === 1) {
				setStep("prompt");
			} else {
				setStep("select-repo");
			}
		} else if (step === "error") {
			setStep("enter-token");
		}
	}

	// Handle keyboard input
	useInput((input, key) => {
		if (step === "prompt") {
			if (key.return) {
				handlePromptConfirm(true);
				return;
			}
			if (key.escape) {
				onCancel();
				return;
			}
			// 'y' or 'Y' for yes
			if (input === "y" || input === "Y") {
				handlePromptConfirm(true);
				return;
			}
			// 'n' or 'N' for no
			if (input === "n" || input === "N") {
				handlePromptConfirm(false);
				return;
			}
		} else if (step === "select-repo") {
			if (key.escape) {
				handleGoBack();
				return;
			}
			if (key.return) {
				handleRepoSelect();
				return;
			}
			if (key.upArrow) {
				setSelectedRepoIndex((prev) => Math.max(0, prev - 1));
				return;
			}
			if (key.downArrow) {
				setSelectedRepoIndex((prev) => Math.min(repos.length - 1, prev + 1));
				return;
			}
		} else if (step === "enter-token") {
			if (key.escape) {
				handleGoBack();
				return;
			}
			if (key.return) {
				handleTokenSubmit();
				return;
			}
			if (key.backspace || input === "\b") {
				setGithubToken((prev) => prev.slice(0, -1));
				setError(null);
				return;
			}
			if (input && !key.ctrl && !key.meta) {
				setGithubToken((prev) => prev + input);
				setError(null);
				return;
			}
		} else if (step === "success") {
			if (key.return) {
				handleComplete();
				return;
			}
		} else if (step === "error") {
			if (key.return) {
				handleGoBack();
				return;
			}
			if (key.escape) {
				handleGoBack();
				return;
			}
		}
	});

	// Render prompt step
	if (step === "prompt") {
		return (
			<Box flexDirection="column" paddingY={1}>
				<Box marginBottom={1}>
					<Text bold color="cyan">
						{"═══ GitHub Actions Workflow ═══"}
					</Text>
				</Box>

				<Box marginBottom={1}>
					<Text>Would you like to set up a GitHub Actions workflow to run tests</Text>
				</Box>
				<Box marginBottom={1}>
					<Text>and report results back to Codowave?</Text>
				</Box>

				<Box marginTop={1}>
					<Text color="green">  [y] Yes, set up workflow</Text>
				</Box>
				<Box>
					<Text color="gray">  [n] Skip for now</Text>
				</Box>

				<Box marginTop={1}>
					<Text color="gray">
						<Text bold>Y</Text> or <Text bold>Enter</Text> to continue | <Text bold>N</Text> to skip | <Text bold>Esc</Text> to cancel
					</Text>
				</Box>
			</Box>
		);
	}

	// Render repository selection step
	if (step === "select-repo") {
		return (
			<Box flexDirection="column" paddingY={1}>
				<Box marginBottom={1}>
					<Text bold color="cyan">
						{"═══ Select Repository ═══"}
					</Text>
				</Box>

				<Box marginBottom={1}>
					<Text>Choose a repository to add the workflow to:</Text>
				</Box>

				<Box flexDirection="column" marginBottom={1}>
					{repos.map((repo, index) => (
						<Box key={index}>
							<Text>{index === selectedRepoIndex ? " > " : "   "}</Text>
							<Text bold={index === selectedRepoIndex} color={index === selectedRepoIndex ? "green" : "white"}>
								{repo.owner}/{repo.name}
							</Text>
						</Box>
					))}
				</Box>

				{error && (
					<Box marginTop={1}>
						<Text color="red">{pc.red("✖ " + error)}</Text>
					</Box>
				)}

				<Box marginTop={1}>
					<Text color="gray">
						<Text bold>↑/↓</Text> navigate | <Text bold>Enter</Text> select | <Text bold>Esc</Text> back
					</Text>
				</Box>
			</Box>
		);
	}

	// Render token input step
	if (step === "enter-token") {
		const selectedRepo = repos[selectedRepoIndex]!;
		return (
			<Box flexDirection="column" paddingY={1}>
				<Box marginBottom={1}>
					<Text bold color="cyan">
						{"═══ GitHub Token ═══"}
					</Text>
				</Box>

				<Box marginBottom={1}>
					<Text>Enter a GitHub token with repo write access for </Text>
				</Box>
				<Box marginBottom={1}>
					<Text bold color="green">{selectedRepo.owner}/{selectedRepo.name}</Text>
				</Box>

				<Box marginBottom={1}>
					<Text dimColor>(Token needs 'repo' scope for private repos)</Text>
				</Box>

				<Box>
					<Text color="gray">{"> "}</Text>
					<Text>{githubToken ? "•".repeat(githubToken.length) : ""}</Text>
					<Text color="cyan">_</Text>
				</Box>

				{error && (
					<Box marginTop={1}>
						<Text color="red">{pc.red("✖ " + error)}</Text>
					</Box>
				)}

				<Box marginTop={1}>
					<Text color="gray">
						<Text bold>Enter</Text> create workflow | <Text bold>Esc</Text> back
					</Text>
				</Box>
			</Box>
		);
	}

	// Render creating step
	if (step === "creating") {
		return (
			<Box flexDirection="column" paddingY={1}>
				<Box marginBottom={1}>
					<Text bold color="cyan">
						{"═══ Creating Workflow ═══"}
					</Text>
				</Box>

				<Box>
					<Text color="yellow">
						<Spinner type="dots" /> Creating GitHub Actions workflow...
					</Text>
				</Box>
			</Box>
		);
	}

	// Render success step
	if (step === "success") {
		return (
			<Box flexDirection="column" paddingY={1}>
				<Box marginBottom={1}>
					<Text bold color="green">
						{"═══ ✓ Workflow Created ═══"}
					</Text>
				</Box>

				<Box marginBottom={1}>
					<Text>Successfully created </Text>
					<Text bold>.github/workflows/codowave-test.yml</Text>
				</Box>

				<Box marginBottom={1}>
					<Text color="gray">The workflow will:</Text>
				</Box>
				<Box marginLeft={2} marginBottom={1}>
					<Text dimColor>• Run tests on push and pull requests</Text>
				</Box>
				<Box marginLeft={2} marginBottom={1}>
					<Text dimColor>• Report results back to Codowave</Text>
				</Box>

				{actionsUrl && (
					<Box marginTop={1}>
						<Text>View workflow: </Text>
						<Text color="cyan">{actionsUrl}</Text>
					</Box>
				)}

				<Box marginTop={2}>
					<Text color="gray">
						<Text bold>Enter</Text> to continue
					</Text>
				</Box>
			</Box>
		);
	}

	// Render error step
	if (step === "error") {
		return (
			<Box flexDirection="column" paddingY={1}>
				<Box marginBottom={1}>
					<Text bold color="red">
						{"═══ ✖ Error ═══"}
					</Text>
				</Box>

				<Box marginBottom={1}>
					<Text color="red">{error}</Text>
				</Box>

				<Box marginTop={1}>
					<Text color="gray">
						<Text bold>Enter</Text> or <Text bold>Esc</Text> to go back and try again
					</Text>
				</Box>
			</Box>
		);
	}

	return null;
};
