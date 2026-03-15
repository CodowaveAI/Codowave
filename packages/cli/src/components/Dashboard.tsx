import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import pc from "picocolors";
import { Run, RunRow } from "./RunRow.js";

interface DashboardProps {
	fetchRuns: () => Promise<Run[]>;
	pollInterval?: number;
}

export const Dashboard: React.FC<DashboardProps> = ({
	fetchRuns,
	pollInterval = 5000,
}) => {
	const [runs, setRuns] = useState<Run[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;

		const fetchData = async () => {
			try {
				const data = await fetchRuns();
				if (!cancelled) {
					setRuns(data);
					setError(null);
				}
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof Error ? err.message : "Failed to fetch runs");
				}
			} finally {
				if (!cancelled) {
					setLoading(false);
				}
			}
		};

		// Initial fetch
		fetchData();

		// Set up polling
		const interval = setInterval(fetchData, pollInterval);

		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	}, [fetchRuns, pollInterval]);

	if (loading) {
		return (
			<Box flexDirection="column" padding={1}>
				<Text color="yellow">Loading runs...</Text>
			</Box>
		);
	}

	if (error) {
		return (
			<Box flexDirection="column" padding={1}>
				<Text color="red">{pc.red("Error:")} {error}</Text>
			</Box>
		);
	}

	if (runs.length === 0) {
		return (
			<Box flexDirection="column" padding={1}>
				<Text color="gray">No active runs found.</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column" padding={1} borderStyle="round" borderDimColor>
			<Box flexDirection="column" marginBottom={1}>
				<Text bold>Active Runs</Text>
				<Text color="gray">
					{`Auto-refreshing every ${pollInterval / 1000}s`}
				</Text>
			</Box>

			{/* Header */}
			<Box flexDirection="row" gap={2} marginBottom={1}>
				<Box width={12}>
					<Text bold color="gray">
						Repository
					</Text>
				</Box>
				<Box width={10}>
					<Text bold color="gray">
						Issue
					</Text>
				</Box>
				<Box flexGrow={1} width={30}>
					<Text bold color="gray">
						Title
					</Text>
				</Box>
				<Box width={14}>
					<Text bold color="gray">
						Stage
					</Text>
				</Box>
				<Box width={8}>
					<Text bold color="gray">
						Elapsed
					</Text>
				</Box>
			</Box>

			{/* Run rows */}
			{runs.map((run) => (
				<RunRow key={run.id} run={run} />
			))}
		</Box>
	);
};

export { Run };
