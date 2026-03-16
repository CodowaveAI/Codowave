import React, { useState, useEffect, useRef } from "react";
import {
  Box,
  Text,
  useInput,
} from "ink";
import Spinner from "ink-spinner";
import pc from "picocolors";

type Repo = {
	owner: string;
	name: string;
	id?: string;
};

type Props = {
	apiUrl: string;
	onComplete: (apiKey: string, repos: Repo[]) => void;
	onCancel: () => void;
};

type Step = "api-key" | "repos";

export const GithubAppStep: React.FC<Props> = ({ apiUrl, onComplete, onCancel }) => {
	const [step, setStep] = useState<Step>("api-key");
	const [apiKey, setApiKey] = useState("");
	const [repos, setRepos] = useState<Repo[]>([]);
	const [selectedRepos, setSelectedRepos] = useState<Set<number>>(new Set());
	const [currentSelection, setCurrentSelection] = useState(0);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Fetch repos when API key is validated
	useEffect(() => {
		if (step === "repos" && apiKey && repos.length === 0 && !loading) {
			fetchRepos();
		}
	}, [step, apiKey]);

	async function fetchRepos() {
		setLoading(true);
		setError(null);

		try {
			// Call the API to get repositories
			// This endpoint should return the repos associated with the API key
			const response = await fetch(`${apiUrl}/api/v1/repos`, {
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
				},
			});

			if (!response.ok) {
				if (response.status === 401) {
					throw new Error("Invalid API key. Please check and try again.");
				}
				throw new Error(`Failed to fetch repositories: ${response.status}`);
			}

			const data = await response.json() as { repos?: Repo[]; repositories?: Repo[] };
			// Expected response format: { repos: [{ owner, name, id? }] }
			const fetchedRepos = data.repos || data.repositories || [];
			setRepos(fetchedRepos);
			// Select all by default
			if (fetchedRepos.length > 0) {
				const allIndices = new Set<number>();
				for (let i = 0; i < fetchedRepos.length; i++) {
					allIndices.add(i);
				}
				setSelectedRepos(allIndices);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to fetch repositories");
		} finally {
			setLoading(false);
		}
	}

	function handleApiKeySubmit() {
		if (!apiKey.trim()) {
			setError("API key cannot be empty");
			return;
		}
		setError(null);
		setStep("repos");
	}

	function handleConfirm() {
		const selected = Array.from(selectedRepos)
			.map((i) => repos[i])
			.filter((repo): repo is Repo => repo !== undefined);
		onComplete(apiKey, selected);
	}

	function handleGoBack() {
		setStep("api-key");
		setError(null);
	}

	// Handle keyboard input
	useInput((input, key) => {
		if (step === "api-key") {
			// Handle Enter key
			if (key.return) {
				handleApiKeySubmit();
				return;
			}
			// Handle Escape key
			if (key.escape) {
				onCancel();
				return;
			}
			// Handle backspace
			if (key.backspace || input === "\b") {
				setApiKey((prev) => prev.slice(0, -1));
				setError(null);
				return;
			}
			// Handle regular character input
			if (input && !key.ctrl && !key.meta) {
				setApiKey((prev) => prev + input);
				setError(null);
				return;
			}
		} else if (step === "repos") {
			// Handle Escape key - go back
			if (key.escape) {
				handleGoBack();
				return;
			}
			// Handle Enter key - confirm
			if (key.return) {
				handleConfirm();
				return;
			}
			// Handle Space - toggle selection
			if (input === " ") {
				toggleRepo(currentSelection);
				return;
			}
			// Handle Up arrow - move selection up
			if (key.upArrow) {
				setCurrentSelection((prev) => Math.max(0, prev - 1));
				return;
			}
			// Handle Down arrow - move selection down
			if (key.downArrow) {
				setCurrentSelection((prev) => Math.min(repos.length - 1, prev + 1));
				return;
			}
			// Handle 'a' key - select all
			if (input === "a" || input === "A") {
				const allIndices = new Set<number>();
				for (let i = 0; i < repos.length; i++) {
					allIndices.add(i);
				}
				setSelectedRepos(allIndices);
				return;
			}
			// Handle 'n' key - select none
			if (input === "n" || input === "N") {
				setSelectedRepos(new Set());
				return;
			}
		}
	});

	function toggleRepo(index: number) {
		const newSelected = new Set(selectedRepos);
		if (newSelected.has(index)) {
			newSelected.delete(index);
		} else {
			newSelected.add(index);
		}
		setSelectedRepos(newSelected);
	}

	// Render API key input step
	if (step === "api-key") {
		return (
			<Box flexDirection="column" paddingY={1}>
				<Box marginBottom={1}>
					<Text bold color="cyan">
						{"═══ GitHub App Setup ═══"}
					</Text>
				</Box>

				<Box marginBottom={1}>
					<Text>Enter your Codowave API key:</Text>
				</Box>

				<Box>
					<Text color="gray">{"> "}</Text>
					<Text>{apiKey}</Text>
					<Text color="cyan">_</Text>
				</Box>

				{error && (
					<Box marginTop={1}>
						<Text color="red">{pc.red("✖ " + error)}</Text>
					</Box>
				)}

				<Box marginTop={1}>
					<Text color="gray">
						Press <Text bold>Enter</Text> to continue, <Text bold>Esc</Text> to cancel
					</Text>
				</Box>
			</Box>
		);
	}

	// Render repository selection step
	if (step === "repos") {
		return (
			<Box flexDirection="column" paddingY={1}>
				<Box marginBottom={1}>
					<Text bold color="cyan">
						{"═══ Select Repositories ═══"}
					</Text>
				</Box>

				{loading && (
					<Box>
						<Text color="yellow">
							<Spinner type="dots" /> Loading repositories...
						</Text>
					</Box>
				)}

				{error && (
					<Box marginBottom={1}>
						<Text color="red">{pc.red("✖ " + error)}</Text>
					</Box>
				)}

				{!loading && !error && repos.length === 0 && (
					<Box marginBottom={1}>
						<Text color="yellow">No repositories found for this API key.</Text>
					</Box>
				)}

				{!loading && repos.length > 0 && (
					<Box flexDirection="column" marginBottom={1}>
						{repos.map((repo, index) => (
							<Box key={index}>
								<Text>{index === currentSelection ? " > " : "   "}</Text>
								<Text color={selectedRepos.has(index) ? "green" : "gray"}>
									[{selectedRepos.has(index) ? "✓" : " "}]
								</Text>
								<Text> </Text>
								<Text bold={index === currentSelection}>
									<Text dimColor={!selectedRepos.has(index)}>
										{repo.owner}/{repo.name}
									</Text>
								</Text>
							</Box>
						))}
					</Box>
				)}

				{!loading && repos.length > 0 && (
					<Box marginTop={1}>
						<Text color="gray">
							<Text bold>↑/↓</Text> navigate | <Text bold>Space</Text> toggle | <Text bold>A</Text> all | <Text bold>N</Text> none
						</Text>
					</Box>
				)}

				<Box marginTop={1}>
					<Text color="gray">
						Selected: <Text bold color="green">{selectedRepos.size}</Text> / {repos.length} repos | <Text bold>Enter</Text> confirm | <Text bold>Esc</Text> back
					</Text>
				</Box>
			</Box>
		);
	}

	return null;
};
