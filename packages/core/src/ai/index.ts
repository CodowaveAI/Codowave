import type { Plan, Patch, RepoContext } from '../types/index.js';

export interface CodowaveAI {
  plan(context: RepoContext): Promise<Plan>;
  code(plan: Plan, context: RepoContext): Promise<Patch>;
  review(prDiff: string, context: RepoContext): Promise<{ approved: boolean; comments: string[] }>;
}
