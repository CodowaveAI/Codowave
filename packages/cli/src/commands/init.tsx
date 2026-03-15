import { Command } from "commander";
import pc from "picocolors";
import { render } from "ink";
import React from "react";
import { writeConfig, readConfig, getConfigPath } from "../config.js";
import { GithubAppStep } from "../components/init/GithubAppStep.js";

type Repo = {
	owner: string;
	name: string;
	id?: string;
};

export const initCommand = new Command("init")
	.description("Initialize Codowave and connect your GitHub repositories")
	.action(async () => {
		const existingConfig = readConfig();
		const defaultApiUrl = "https://api.codowave.com";
		const apiUrl = existingConfig?.apiUrl || defaultApiUrl;

		// If already initialized, ask if they want to reconfigure
		if (existingConfig?.apiKey) {
			console.log(pc.yellow("\n⚠ Codowave is already initialized.\n"));
			console.log(`  API URL: ${pc.cyan(existingConfig.apiUrl)}`);
			console.log(`  Config: ${getConfigPath()}`);
			console.log(pc.gray("\n  Run this command again to reconfigure.\n"));
			return;
		}

		let wizardComplete = false;
		let capturedApiKey = "";
		let capturedRepos: Repo[] = [];

		const { waitUntilExit } = render(
			<GithubAppStep
				apiUrl={apiUrl}
				onComplete={(apiKey, repos) => {
					capturedApiKey = apiKey;
					capturedRepos = repos;
					wizardComplete = true;
				}}
				onCancel={() => {
					process.exit(0);
				}}
			/>
		);

		await waitUntilExit();

		if (!wizardComplete) {
			return;
		}

		// Save the configuration
		writeConfig({
			apiKey: capturedApiKey,
			apiUrl: apiUrl,
			repos: capturedRepos,
		});

		console.log(pc.green("\n✓ Initialization complete!"));
		console.log(`\n  Config saved to: ${pc.cyan(getConfigPath())}`);
		console.log(`  API URL: ${pc.cyan(apiUrl)}`);
		console.log(`  Repositories: ${pc.bold(capturedRepos.length)} configured\n`);
		console.log(pc.gray("  Run ") + pc.bold("codowave run") + pc.gray(" to start coding!\n"));
	});
