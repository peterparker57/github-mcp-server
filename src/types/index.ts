import { Octokit } from '@octokit/rest';

export interface GitHubAccount {
  owner: string;
  token: string;
}

export interface TreeEntry {
  path: string;
  mode: '100644' | '100755' | '040000' | '160000' | '120000';
  type: 'blob' | 'tree' | 'commit';
  sha: string;
}

export interface GitHubService {
  octokit: Octokit;
  selectedOwner: string | undefined;
  getOctokitForOwner(owner?: string): Octokit;
  listAccounts(): string[];
  selectAccount(owner: string): void;
  getEffectiveOwner(owner?: string): string;
}

// Make interfaces extend Record<string, unknown> to allow indexing
export interface RepositoryOptions extends Record<string, unknown> {
  owner?: string;
  name: string;
  description: string;
  private?: boolean;
  readme_content?: string;
}

export interface FileOperation extends Record<string, unknown> {
  owner?: string;
  repo: string;
  path: string;
  message: string;
  content?: string;
  branch?: string;
  sha?: string;
}

export interface CommitOperation extends Record<string, unknown> {
  owner?: string;
  repo: string;
  branch: string;
  message: string;
  changes: Array<{
    path: string;
    sourcePath?: string;
    operation: 'add' | 'modify' | 'delete';
  }>;
  author?: {
    name: string;
    email: string;
  };
  sign?: boolean;
}

export interface CloneOperation extends Record<string, unknown> {
  owner?: string;
  repo: string;
  branch?: string;
  outputDir: string;
}

// Response type that matches the SDK's expectations
export interface ToolResponse {
  _meta?: {
    progressToken?: string | number;
  };
  content: Array<{
    type: string;
    text: string;
  }>;
  isError?: boolean;
}

// Helper function to validate required fields
export function validateArgs<T extends Record<string, unknown>>(
  args: Record<string, unknown> | undefined,
  requiredFields: string[]
): asserts args is T {
  if (!args) {
    throw new Error('Arguments are required');
  }
  
  for (const field of requiredFields) {
    if (!(field in args)) {
      throw new Error(`Missing required field: ${field}`);
    }
  }
}

// Helper function to create a tool response
export function createResponse(data: unknown, isError = false): ToolResponse {
  return {
    content: [{
      type: 'text',
      text: typeof data === 'string' ? data : JSON.stringify(data, null, 2)
    }],
    isError
  };
}