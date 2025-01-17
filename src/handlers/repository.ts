import { promisify } from 'util';
import { exec } from 'child_process';
import { promises as fs } from 'fs';
import { GitHubService, ToolResponse, RepositoryOptions, CloneOperation, createResponse, validateArgs } from '../types/index.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { handlePushFile } from './file.js';

const execAsync = promisify(exec);

export async function handleCreateRepository(
  githubService: GitHubService,
  args: Record<string, unknown> | undefined
): Promise<ToolResponse> {
  validateArgs<RepositoryOptions>(args, ['name', 'description']);
  const { owner, name, description, private: isPrivate = true } = args;
  const octokit = githubService.getOctokitForOwner(owner as string | undefined);
  const effectiveOwner = githubService.getEffectiveOwner(owner as string | undefined);
  
  // Create repository with auto-initialized README
  const response = await octokit.repos.createForAuthenticatedUser({
    name: name as string,
    description: description as string,
    private: isPrivate,
    auto_init: true,
    has_wiki: false
  });

  // Wait for GitHub to complete initialization
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Add a default README with repository information
  try {
    const defaultReadme = `# ${name}\n\n${description}\n\n## About\n\nThis repository was created by the GitHub MCP server under the \`${effectiveOwner}\` account.`;
    
    // Write README to temporary file
    const tempPath = `${process.env.TEMP || '/tmp'}/readme-${Date.now()}.md`;
    await fs.writeFile(tempPath, defaultReadme, 'utf-8');

    try {
      // Use handlePushFile to upload the README
      await handlePushFile(githubService, {
        owner,
        repo: name as string,
        path: 'README.md',
        message: 'Update README with repository details',
        sourcePath: tempPath
      });
    } finally {
      // Clean up temporary file
      await fs.unlink(tempPath).catch(console.error);
    }
  } catch (error) {
    console.error('Error updating README:', error);
    // Don't throw - the repository was still created successfully
  }

  return createResponse(response.data);
}

export async function handleCloneRepository(
  githubService: GitHubService,
  args: Record<string, unknown> | undefined
): Promise<ToolResponse> {
  validateArgs<CloneOperation>(args, ['repo', 'outputDir']);
  const { owner, repo, outputDir, branch = 'main' } = args;
  console.error('Cloning repository:', { owner, repo, outputDir, branch });

  try {
    // Ensure directory exists
    await fs.mkdir(outputDir as string, { recursive: true });

    const effectiveOwner = githubService.getEffectiveOwner(owner as string | undefined);
    const octokit = githubService.getOctokitForOwner(owner as string | undefined);

    // Get the token for authentication
    const accounts = process.env.GITHUB_TOKEN_1 ? parseGitHubAccounts() : [];
    const account = accounts.find(acc => acc.owner.toLowerCase() === effectiveOwner.toLowerCase());
    if (!account) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `No GitHub token configured for owner: ${effectiveOwner}`
      );
    }

    // Use git clone with authentication
    const repoUrl = `https://x-access-token:${account.token}@github.com/${effectiveOwner}/${repo}`;
    await execAsync(`git clone -b ${branch} ${repoUrl} "${outputDir}"`);

    return createResponse(`Repository cloned successfully to ${outputDir}`);
  } catch (error: any) {
    console.error('Clone repository error:', error);
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to clone repository: ${error.message}`
    );
  }
}

// Helper function to parse GitHub accounts from environment variables
function parseGitHubAccounts(): Array<{ owner: string; token: string }> {
  const accounts: Array<{ owner: string; token: string }> = [];
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('GITHUB_TOKEN_')) {
      const id = key.replace('GITHUB_TOKEN_', '');
      const ownerKey = `GITHUB_OWNER_${id}`;
      const owner = process.env[ownerKey];
      
      if (value && owner) {
        accounts.push({ owner, token: value });
      }
    }
  }
  return accounts;
}

export async function handleRenameRepository(
  githubService: GitHubService,
  args: Record<string, unknown> | undefined
): Promise<ToolResponse> {
  if (!args) throw new Error('Arguments are required');
  const { owner, repo, new_name } = args;
  console.error('Renaming repository:', { owner, repo, new_name });

  try {
    const octokit = githubService.getOctokitForOwner(owner as string | undefined);
    const effectiveOwner = githubService.getEffectiveOwner(owner as string | undefined);

    const response = await octokit.repos.update({
      owner: effectiveOwner,
      repo: repo as string,
      name: new_name as string
    });

    return createResponse(response.data);
  } catch (error: any) {
    console.error('Rename repository error:', error);
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to rename repository: ${error.message}`
    );
  }
}

export const repositoryTools = [
  {
    name: 'create_repository',
    description: 'Create a new GitHub repository',
    inputSchema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'Repository owner (optional if account already selected)'
        },
        name: {
          type: 'string',
          description: 'Repository name'
        },
        description: {
          type: 'string',
          description: 'Repository description'
        },
        private: {
          type: 'boolean',
          description: 'Whether the repository should be private'
        }
      },
      required: ['name', 'description']
    }
  },
  {
    name: 'clone_repository',
    description: 'Clone a GitHub repository to a local directory',
    inputSchema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'Repository owner (optional if account already selected)'
        },
        repo: {
          type: 'string',
          description: 'Repository name'
        },
        branch: {
          type: 'string',
          description: 'Branch name'
        },
        outputDir: {
          type: 'string',
          description: 'Local directory to save the repository'
        }
      },
      required: ['repo', 'outputDir']
    }
  },
  {
    name: 'rename_repository',
    description: 'Rename a GitHub repository',
    inputSchema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description: 'Repository owner (optional if account already selected)'
        },
        repo: {
          type: 'string',
          description: 'Current repository name'
        },
        new_name: {
          type: 'string',
          description: 'New repository name'
        }
      },
      required: ['repo', 'new_name']
    }
  }
];