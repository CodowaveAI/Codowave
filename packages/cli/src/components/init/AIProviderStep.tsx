import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import pc from "picocolors";
import { updateConfig } from "../../config.js";
import type { AIProvider } from "../../config.js";

export type AIProviderType = "openai" | "anthropic" | "minimax" | "ollama" | "custom";

export interface AIProviderInfo {
	id: AIProviderType;
	name: string;
	defaultModel: string;
	models: string[];
}

export const AI_PROVIDERS: AIProviderInfo[] = [
	{
		id: "openai",
		name: "OpenAI",
		defaultModel: "gpt-4o",
		models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-4"],
	},
	{
		id: "anthropic",
		name: "Anthropic",
		defaultModel: "claude-sonnet-4-20250514",
		models: ["claude-sonnet-4-20250514", "claude-opus-4-20250514", "claude-3-5-sonnet-20241022", "claude-3-opus-20240229"],
	},
	{
		id: "minimax",
		name: "MiniMax",
		defaultModel: "MiniMax-M2.1",
		models: ["MiniMax-M2.1", "MiniMax-M2-highspeed", "MiniMax-Text-01"],
	},
	{
		id: "ollama",
		name: "Ollama",
		defaultModel: "llama3",
		models: ["llama3", "llama3.1", "llama3.2", "mistral", "codellama", "phi3"],
	},
	{
		id: "custom",
		name: "Custom Endpoint",
		defaultModel: "",
		models: [],
	},
];

type Step = "select-provider" | "api-key" | "model" | "custom-url" | "confirm";

type Props = {
	onComplete: (config: AIProvider) => void;
	onCancel: () => void;
};

export const AIProviderStep: React.FC<Props> = ({ onComplete, onCancel }) => {
	const [step, setStep] = useState<Step>("select-provider");
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [apiKey, setApiKey] = useState("");
	const [model, setModel] = useState("");
	const [customUrl, setCustomUrl] = useState("");
	const [error, setError] = useState<string | null>(null);

	const selectedProvider = AI_PROVIDERS[selectedIndex]!;

	function handleSelectProvider() {
		setModel(selectedProvider.defaultModel);
		setStep("api-key");
		setError(null);
	}

	function handleApiKeySubmit() {
		if (!apiKey.trim()) {
			setError("API key cannot be empty");
			return;
		}
		setError(null);
		if (selectedProvider.id === "custom") {
			setStep("custom-url");
		} else if (selectedProvider.models.length > 0) {
			setStep("model");
		} else {
			setStep("confirm");
		}
	}

	function handleModelSubmit() {
		if (!model.trim()) {
			setError("Model name cannot be empty");
			return;
		}
		setError(null);
		setStep("confirm");
	}

	function handleCustomUrlSubmit() {
		if (!customUrl.trim()) {
			setError("Custom URL cannot be empty");
			return;
		}
		try {
			new URL(customUrl);
		} catch {
			setError("Please enter a valid URL");
			return;
		}
		setError(null);
		setStep("confirm");
	}

	function handleConfirm() {
		const config: AIProvider = {
			provider: selectedProvider.id,
			apiKey: apiKey.trim(),
			model: model.trim(),
			baseUrl: selectedProvider.id === "custom" ? customUrl.trim() : undefined,
		};

		// Save the configuration
		updateConfig({ ai: config });

		onComplete(config);
	}

	function handleGoBack() {
		setError(null);
		if (step === "api-key") {
			setStep("select-provider");
		} else if (step === "model") {
			setStep("api-key");
		} else if (step === "custom-url") {
			setStep("api-key");
		} else if (step === "confirm") {
			if (selectedProvider.id === "custom") {
				setStep("custom-url");
			} else if (selectedProvider.models.length > 0) {
				setStep("model");
			} else {
				setStep("api-key");
			}
		}
	}

	// Handle keyboard input
	useInput((input, key) => {
		// Handle Escape - go back or cancel
		if (key.escape) {
			if (step === "select-provider") {
				onCancel();
			} else {
				handleGoBack();
			}
			return;
		}

		// Handle Enter - submit
		if (key.return) {
			if (step === "select-provider") {
				handleSelectProvider();
			} else if (step === "api-key") {
				handleApiKeySubmit();
			} else if (step === "model") {
				handleModelSubmit();
			} else if (step === "custom-url") {
				handleCustomUrlSubmit();
			} else if (step === "confirm") {
				handleConfirm();
			}
			return;
		}

		// Step-specific input handling
		if (step === "select-provider") {
			if (key.upArrow) {
				setSelectedIndex((prev) => Math.max(0, prev - 1));
				return;
			}
			if (key.downArrow) {
				setSelectedIndex((prev) => Math.min(AI_PROVIDERS.length - 1, prev + 1));
				return;
			}
		} else if (step === "api-key") {
			if (key.backspace || input === "\b") {
				setApiKey((prev) => prev.slice(0, -1));
				setError(null);
				return;
			}
			if (input && !key.ctrl && !key.meta) {
				setApiKey((prev) => prev + input);
				setError(null);
				return;
			}
		} else if (step === "model") {
			if (key.backspace || input === "\b") {
				setModel((prev) => prev.slice(0, -1));
				setError(null);
				return;
			}
			if (input && !key.ctrl && !key.meta) {
				setModel((prev) => prev + input);
				setError(null);
				return;
			}
		} else if (step === "custom-url") {
			if (key.backspace || input === "\b") {
				setCustomUrl((prev) => prev.slice(0, -1));
				setError(null);
				return;
			}
			if (input && !key.ctrl && !key.meta) {
				setCustomUrl((prev) => prev + input);
				setError(null);
				return;
			}
		}
	});

	// Render provider selection
	if (step === "select-provider") {
		return (
			<Box flexDirection="column" paddingY={1}>
				<Box marginBottom={1}>
					<Text bold color="cyan">
						{"═══ Select AI Provider ═══"}
					</Text>
				</Box>

				<Box flexDirection="column" marginBottom={1}>
					{AI_PROVIDERS.map((provider, index) => (
						<Box key={provider.id}>
							<Text>{index === selectedIndex ? " > " : "   "}</Text>
							<Text color={index === selectedIndex ? "green" : "white"} bold={index === selectedIndex}>
								{provider.name}
							</Text>
							{provider.id === "custom" && (
								<Text dimColor> (enter custom endpoint)</Text>
							)}
						</Box>
					))}
				</Box>

				<Box marginTop={1}>
					<Text color="gray">
						<Text bold>↑/↓</Text> navigate | <Text bold>Enter</Text> select | <Text bold>Esc</Text> cancel
					</Text>
				</Box>
			</Box>
		);
	}

	// Render API key input
	if (step === "api-key") {
		return (
			<Box flexDirection="column" paddingY={1}>
				<Box marginBottom={1}>
					<Text bold color="cyan">
						{"═══ " + selectedProvider.name + " API Key ═══"}
					</Text>
				</Box>

				<Box marginBottom={1}>
					<Text>Enter your {selectedProvider.name} API key:</Text>
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
						<Text bold>Enter</Text> continue | <Text bold>Esc</Text> back
					</Text>
				</Box>
			</Box>
		);
	}

	// Render model selection/input
	if (step === "model") {
		const showModelDropdown = selectedProvider.models.length > 0;

		return (
			<Box flexDirection="column" paddingY={1}>
				<Box marginBottom={1}>
					<Text bold color="cyan">
						{"═══ Select Model ═══"}
					</Text>
				</Box>

				<Box marginBottom={1}>
					<Text>Choose a model for {selectedProvider.name}:</Text>
				</Box>

				{showModelDropdown ? (
					<Box flexDirection="column" marginBottom={1}>
						{selectedProvider.models.map((m, index) => (
							<Box key={m}>
								<Text>   </Text>
								<Text bold color={model === m ? "green" : "white"}>
									{model === m ? "● " : "○ "}
								</Text>
								<Text color={model === m ? "green" : "gray"}>{m}</Text>
							</Box>
						))}
					</Box>
				) : (
					<Box>
						<Text color="gray">{"> "}</Text>
						<Text>{model}</Text>
						<Text color="cyan">_</Text>
					</Box>
				)}

				{!showModelDropdown && (
					<Box marginTop={1}>
						<Text dimColor>Type a custom model name</Text>
					</Box>
				)}

				{error && (
					<Box marginTop={1}>
						<Text color="red">{pc.red("✖ " + error)}</Text>
					</Box>
				)}

				<Box marginTop={1}>
					<Text color="gray">
						<Text bold>Enter</Text> confirm | <Text bold>Esc</Text> back
					</Text>
				</Box>
			</Box>
		);
	}

	// Render custom URL input
	if (step === "custom-url") {
		return (
			<Box flexDirection="column" paddingY={1}>
				<Box marginBottom={1}>
					<Text bold color="cyan">
						{"═══ Custom Endpoint URL ═══"}
					</Text>
				</Box>

				<Box marginBottom={1}>
					<Text>Enter your custom API endpoint URL:</Text>
				</Box>

				<Box>
					<Text color="gray">{"> "}</Text>
					<Text>{customUrl}</Text>
					<Text color="cyan">_</Text>
				</Box>

				{error && (
					<Box marginTop={1}>
						<Text color="red">{pc.red("✖ " + error)}</Text>
					</Box>
				)}

				<Box marginTop={1}>
					<Text color="gray">
						<Text bold>Enter</Text> continue | <Text bold>Esc</Text> back
					</Text>
				</Box>
			</Box>
		);
	}

	// Render confirmation
	if (step === "confirm") {
		return (
			<Box flexDirection="column" paddingY={1}>
				<Box marginBottom={1}>
					<Text bold color="cyan">
						{"═══ Confirm Configuration ═══"}
					</Text>
				</Box>

				<Box marginBottom={1}>
					<Text>AI Provider: </Text>
					<Text bold color="green">{selectedProvider.name}</Text>
				</Box>

				<Box marginBottom={1}>
					<Text>Model: </Text>
					<Text bold>{model || "default"}</Text>
				</Box>

				{selectedProvider.id === "custom" && (
					<Box marginBottom={1}>
						<Text>Endpoint: </Text>
						<Text bold dimColor>{customUrl}</Text>
					</Box>
				)}

				<Box marginTop={1}>
					<Text color="green">✓ API key configured</Text>
				</Box>

				<Box marginTop={2}>
					<Text color="gray">
						<Text bold>Enter</Text> save and continue | <Text bold>Esc</Text> back
					</Text>
				</Box>
			</Box>
		);
	}

	return null;
};
