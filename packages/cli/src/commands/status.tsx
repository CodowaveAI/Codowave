import { render } from "ink";
import React from "react";
import { Command } from "commander";
import pc from "picocolors";
import { readConfigOrThrow } from "../config.js";
import { Dashboard, Run } from "../components/Dashboard.js";

async function fetchRunsFromApi(apiUrl: string, apiKey: string): Promise<Run[]> {
	const response = await fetch(`${apiUrl}/api/v1/runs?status=active`, {
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
	});

	if (!response.ok) {
		throw new Error(`API error: ${response.status} ${response.statusText}`);
	}

	const data = await response.json() as { runs?: Run[] };
	return data.runs ?? [];
}

export const statusCommand = new Command("status")
	.description("Show the status of active Codowave runs (live dashboard)")
	.option(
		"--api-url <url>",
		"Override the Codowave API URL"
	)
	.action(async (options: { apiUrl?: string }) => {
		const config = readConfigOrThrow();
		const apiUrl = options.apiUrl ?? config.apiUrl;

		const fetchRuns = () => fetchRunsFromApi(apiUrl, config.apiKey);

		const { waitUntilExit } = render(
			<Dashboard fetchRuns={fetchRuns} pollInterval={5000} />
		);

		await waitUntilExit();
	});
