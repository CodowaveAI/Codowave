/**
 * Feature Suggester Cron Task
 *
 * Runs Mon/Wed/Fri at 10am UTC to analyze:
 * - Hacker News top stories
 * - GitHub trending repositories
 *
 * Uses AI to generate 1-3 relevant feature suggestions per repo,
 * then creates GitHub issues tagged with `enhancement` and `needs-review`.
 */

import { task, logger } from '@trigger.dev/sdk/v3';
import { db, schema } from '../db/index.js';
import { eq, and } from 'drizzle-orm';
import { generateText } from 'ai';
import { aiProvider, DEFAULT_MODEL } from '../agent/ai-client.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FeatureSuggesterInput {
  /** Repository full name to generate suggestions for (e.g., "owner/repo") */
  repositoryFullName?: string;
  /** Number of HN stories to fetch (default: 10) */
  hnLimit?: number;
  /** Number of trending repos to fetch (default: 5) */
  trendingLimit?: number;
  /** Whether to create GitHub issues (default: true) */
  createIssues?: boolean;
}

export interface FeatureSuggesterPayload {
  input: FeatureSuggesterInput;
}

export interface HackerNewsStory {
  id: number;
  title: string;
  url?: string;
  score: number;
  by: string;
  time: number;
  descendants: number;
}

export interface TrendingRepo {
  name: string;
  fullName: string;
  description: string;
  stars: number;
  language: string;
  url: string;
}

export interface FeatureSuggestion {
  title: string;
  description: string;
  rationale: string;
}

// ─── Scheduled Task Definition ───────────────────────────────────────────────

/**
 * Feature Suggester Scheduled Task
 *
 * Runs Mon/Wed/Fri at 10am UTC (cron: 0 10 * * 1,3,5)
 * Fetches HN top stories and GitHub trending repos,
 * generates AI-powered feature suggestions,
 * and creates GitHub issues for relevant ideas.
 */
export const featureSuggesterTask = task({
  id: 'feature-suggester',
  maxDuration: 600, // 10 minutes max
  retry: {
    maxAttempts: 2,
    factor: 2,
  },
  run: async (payload: FeatureSuggesterPayload) => {
    const { input } = payload;
    const {
      repositoryFullName,
      hnLimit = 10,
      trendingLimit = 5,
      createIssues = true,
    } = input;

    logger.info('Starting feature suggestion analysis');

    const startTime = Date.now();
    const suggestionsCreated: number[] = [];

    try {
      // ─────────────────────────────────────────────────────────────────────────
      // Step 1: Fetch Hacker News top stories
      // ─────────────────────────────────────────────────────────────────────────
      logger.info(`Fetching top ${hnLimit} Hacker News stories`);
      const hnStories = await fetchHackerNewsTopStories(hnLimit);
      logger.info(`Fetched ${hnStories.length} HN stories`);

      // ─────────────────────────────────────────────────────────────────────────
      // Step 2: Fetch GitHub trending repositories
      // ─────────────────────────────────────────────────────────────────────────
      logger.info(`Fetching ${trendingLimit} trending GitHub repos`);
      const trendingRepos = await fetchGitHubTrendingRepos(trendingLimit);
      logger.info(`Fetched ${trendingRepos.length} trending repos`);

      // ─────────────────────────────────────────────────────────────────────────
      // Step 3: Get target repositories from database
      // ─────────────────────────────────────────────────────────────────────────
      let targetRepos: Array<{ fullName: string; name: string }> = [];

      if (repositoryFullName) {
        // Use the specified repository
        const [owner, name] = repositoryFullName.split('/');
        if (owner && name) {
          targetRepos = [{ fullName: repositoryFullName, name }];
        }
      } else {
        // Fetch all enabled repositories from the database
        const repoRecords = await db
          .select({
            fullName: schema.repositories.fullName,
            name: schema.repositories.name,
          })
          .from(schema.repositories)
          .where(eq(schema.repositories.enabled, true))
          .limit(20);

        targetRepos = repoRecords;
      }

      logger.info(`Analyzing ${targetRepos.length} repositories`);

      // ─────────────────────────────────────────────────────────────────────────
      // Step 4: For each target repo, generate feature suggestions
      // ─────────────────────────────────────────────────────────────────────────
      const { Octokit } = await import('octokit');
      const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

      for (const repo of targetRepos) {
        try {
          // Generate feature suggestions using AI
          const suggestions = await generateFeatureSuggestions(
            repo.name,
            hnStories,
            trendingRepos
          );

          logger.info(`Generated ${suggestions.length} suggestions for ${repo.fullName}`);

          // ─────────────────────────────────────────────────────────────────────
          // Step 5: Create GitHub issues for suggestions
          // ─────────────────────────────────────────────────────────────────────
          if (createIssues && suggestions.length > 0) {
            const parts = repo.fullName.split('/');
            const owner = parts[0] ?? '';
            const repoName = parts[1] ?? '';

            for (const suggestion of suggestions) {
              try {
                const issueTitle = `[Feature Request] ${suggestion.title}`;
                const issueBody = generateFeatureIssueBody(
                  suggestion,
                  repo.fullName,
                  hnStories,
                  trendingRepos
                );

                const issueResponse = await octokit.request(
                  'POST /repos/{owner}/{repo}/issues',
                  {
                    owner,
                    repo: repoName,
                    title: issueTitle,
                    body: issueBody,
                    labels: ['enhancement', 'needs-review', 'ai-suggested'],
                  }
                );

                suggestionsCreated.push(issueResponse.data.number);
                logger.info(
                  `Created issue #${issueResponse.data.number} for ${repo.fullName}: ${suggestion.title}`
                );
              } catch (issueError) {
                logger.error(
                  `Failed to create issue for ${repo.fullName}: ${issueError}`
                );
              }
            }
          }
        } catch (repoError) {
          logger.error(`Failed to process repo ${repo.fullName}: ${repoError}`);
        }
      }

      const durationMs = Date.now() - startTime;
      logger.info(
        `Feature suggestion completed in ${durationMs}ms. Created ${suggestionsCreated.length} issues`
      );

      return {
        success: true,
        hnStoriesCount: hnStories.length,
        trendingReposCount: trendingRepos.length,
        targetReposCount: targetRepos.length,
        suggestionsCreated: suggestionsCreated.length,
        issueNumbers: suggestionsCreated,
        durationMs,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Feature suggester failed: ${errorMessage}`);

      return {
        success: false,
        error: errorMessage,
        suggestionsCreated: suggestionsCreated.length,
        issueNumbers: suggestionsCreated,
      };
    }
  },
});

// ─── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Fetch top stories from Hacker News
 */
async function fetchHackerNewsTopStories(limit: number): Promise<HackerNewsStory[]> {
  try {
    // Get top story IDs
    const idsResponse = await fetch(
      'https://hacker-news.firebaseio.com/v0/topstories.json',
      { signal: AbortSignal.timeout(10000) }
    );
    
    if (!idsResponse.ok) {
      throw new Error(`HN API error: ${idsResponse.status}`);
    }
    
    const ids: number[] = (await idsResponse.json()) as number[];
    const topIds = ids.slice(0, limit);

    // Fetch story details in parallel
    const storyPromises = topIds.map(async (id) => {
      const storyResponse = await fetch(
        `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
        { signal: AbortSignal.timeout(10000) }
      );
      
      if (!storyResponse.ok) return null;
      
      return storyResponse.json() as Promise<HackerNewsStory>;
    });

    const stories = await Promise.all(storyPromises);
    return stories.filter((s): s is HackerNewsStory => s !== null);
  } catch (error) {
    logger.error(`Failed to fetch HN stories: ${error}`);
    return [];
  }
}

/**
 * Fetch trending repositories from GitHub
 * Uses the GitHub Explore API
 */
async function fetchGitHubTrendingRepos(limit: number): Promise<TrendingRepo[]> {
  try {
    // Fetch trending repos from GitHub Explore API (unofficial but widely used)
    const response = await fetch(
      `https://api.github.com/search/repositories?q=created:>2024-01-01&sort=stars&order=desc&per_page=${limit}`,
      {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          ...(process.env.GITHUB_TOKEN && {
            'Authorization': `token ${process.env.GITHUB_TOKEN}`,
          }),
        },
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const data = await response.json() as {
      items: Array<{
        name: string;
        full_name: string;
        description: string | null;
        stargazers_count: number;
        language: string | null;
        html_url: string;
      }>;
    };

    return data.items.slice(0, limit).map((repo) => ({
      name: repo.name,
      fullName: repo.full_name,
      description: repo.description || 'No description',
      stars: repo.stargazers_count,
      language: repo.language || 'Unknown',
      url: repo.html_url,
    }));
  } catch (error) {
    logger.error(`Failed to fetch trending repos: ${error}`);
    return [];
  }
}

/**
 * Generate feature suggestions using AI
 */
async function generateFeatureSuggestions(
  repoName: string,
  hnStories: HackerNewsStory[],
  trendingRepos: TrendingRepo[]
): Promise<FeatureSuggestion[]> {
  const hnSummary = hnStories
    .slice(0, 5)
    .map((s) => `- ${s.title} (${s.score} points)`)
    .join('\n');

  const trendingSummary = trendingRepos
    .map((r) => `- ${r.fullName}: ${r.description.slice(0, 100)} (${r.stars} ⭐, ${r.language})`)
    .join('\n');

  const prompt = `You are a product manager analyzing a repository called "${repoName}". 
Based on the following trending tech news and popular GitHub repositories, suggest 1-3 relevant feature ideas that would add value to this project.

## Hacker News Top Stories:
${hnSummary}

## Trending GitHub Repositories:
${trendingSummary}

## Task:
Generate 1-3 concise feature suggestions. Each suggestion should include:
1. A clear, specific feature title (prefix with "[Feature]")
2. A brief description (2-3 sentences)
3. Why this would be valuable based on the trends above

Respond in JSON format:
[
  {
    "title": "[Feature] Feature Name",
    "description": "What the feature does",
    "rationale": "Why this is relevant based on current trends"
  }
]

Only respond with valid JSON, no other text.`;

  try {
    const result = await generateText({
      model: aiProvider(DEFAULT_MODEL),
      prompt,
      maxTokens: 1000,
    });

    const text = result.text.trim();
    
    // Try to parse JSON from the response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const suggestions = JSON.parse(jsonMatch[0]) as FeatureSuggestion[];
      return suggestions.slice(0, 3); // Limit to 3 suggestions
    }
    
    return [];
  } catch (error) {
    logger.error(`Failed to generate suggestions: ${error}`);
    return [];
  }
}

/**
 * Generate the body for a feature suggestion issue
 */
function generateFeatureIssueBody(
  suggestion: FeatureSuggestion,
  repositoryFullName: string,
  hnStories: HackerNewsStory[],
  trendingRepos: TrendingRepo[]
): string {
  const hnLinks = hnStories
    .slice(0, 3)
    .map((s) => `- [${s.title}](https://news.ycombinator.com/item?id=${s.id})`)
    .join('\n');

  const trendingLinks = trendingRepos
    .slice(0, 3)
    .map((r) => `- [${r.fullName}](${r.url})`)
    .join('\n');

  return `## Feature Suggestion

${suggestion.description}

### Rationale

${suggestion.rationale}

### Related Trends

**Hacker News:**
${hnLinks}

**Trending Repositories:**
${trendingLinks}

---

*This issue was automatically generated by the Codowave Feature Suggester*
*Repository: ${repositoryFullName}*
`;
}

// Export the task ID for use in other modules
export const FEATURE_SUGGESTER_TASK_ID = 'feature-suggester';
