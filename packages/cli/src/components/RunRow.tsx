import React from "react";
import { Box, Text } from "ink";
import pc from "picocolors";

export type RunStage = "pending" | "queued" | "running" | "analyzing" | "implementing" | "reviewing" | "completed" | "failed";

export interface Run {
	id: string;
	repoOwner: string;
	repoName: string;
	issueNumber: number;
	issueTitle: string;
	stage: RunStage;
	startedAt: string;
	updatedAt: string;
}

interface RunRowProps {
	run: Run;
}

const stageColors: Record<RunStage, (s: string) => string> = {
	pending: pc.gray,
	queued: pc.cyan,
	running: pc.blue,
	analyzing: pc.yellow,
	implementing: pc.magenta,
	reviewing: pc.cyan,
	completed: pc.green,
	failed: pc.red,
};

const stageLabels: Record<RunStage, string> = {
	pending: "PENDING",
	queued: "QUEUED",
	running: "RUNNING",
	analyzing: "ANALYZING",
	implementing: "IMPLEMENTING",
	reviewing: "REVIEWING",
	completed: "DONE",
	failed: "FAILED",
};

function formatElapsedTime(startedAt: string): string {
	const start = new Date(startedAt);
	const now = new Date();
	const diffMs = now.getTime() - start.getTime();

	const seconds = Math.floor(diffMs / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);

	if (hours > 0) {
		return `${hours}h ${minutes % 60}m`;
	}
	if (minutes > 0) {
		return `${minutes}m ${seconds % 60}s`;
	}
	return `${seconds}s`;
}

export const RunRow: React.FC<RunRowProps> = ({ run }) => {
	const elapsed = formatElapsedTime(run.startedAt);
	const stageColor = stageColors[run.stage](stageLabels[run.stage]);

	return (
		<Box flexDirection="row" gap={2}>
			<Box width={12}>
				<Text color="cyan">{run.repoOwner}/{run.repoName}</Text>
			</Box>
			<Box width={10}>
				<Text>#{run.issueNumber}</Text>
			</Box>
			<Box flexGrow={1} width={30}>
				<Text>{run.issueTitle.substring(0, 28)}{run.issueTitle.length > 28 ? "..." : ""}</Text>
			</Box>
			<Box width={14}>
				<Text>{stageColor}</Text>
			</Box>
			<Box width={8}>
				<Text color="gray">{elapsed}</Text>
			</Box>
		</Box>
	);
};
