import { GitHubService, ToolResponse, CommitOperation, createResponse } from '../types/index.js';
import { McpError, ErrorCode, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { promises as fs } from 'fs';
import { resolve } from 'path';
import { debugLogger } from '../utils/debug-logger.js';

export async function handleCreateCommit(
  githubService: GitHubService,
  args: Record<string, unknown> | undefined,
  notifyDevHub?: (repo: string, commitSha: string) => Promise<void>
): Promise<ToolResponse> {
  if (!args) throw new Error('Arguments are required');
  const { owner, repo, branch, message, changes, author, sign } = args as CommitOperation;
  await debugLogger.log('Creating commit:', { owner, repo, branch, message, changes, author, sign });

  try {
    const octokit = githubService.getOctokitForOwner(owner);
    const effectiveOwner = githubService.getEffectiveOwner(owner);
    await debugLogger.log('Using GitHub credentials:', { effectiveOwner });

    // Get the latest commit SHA
    await debugLogger.log('Getting latest commit SHA');
    const ref = await octokit.git.getRef({
      owner: effectiveOwner,
      repo,
      ref: `heads/${branch}`
    });
    const latestCommit = await octokit.git.getCommit({
      owner: effectiveOwner,
      repo,
      commit_sha: ref.data.object.sha
    });
    await debugLogger.log('Got latest commit:', { sha: latestCommit.data.sha });

    // Create blobs for new/modified files
    await debugLogger.log('Processing file changes:', { count: changes.length });
    const trees: Array<{path: string; mode: '100644'; type: 'blob'; sha?: string}> = [];
    for (const change of changes) {
      await debugLogger.log('Processing change:', { change });

      if (change.operation === 'delete') {
        await debugLogger.log('Skipping delete operation in tree');
        continue;
      }

      if (change.operation === 'add' || change.operation === 'modify') {
        if (!change.sourcePath) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `sourcePath required for ${change.operation} operation on ${change.path}`
          );
        }

        // Read content from source file
        await debugLogger.log('Reading source file:', { path: change.sourcePath });
        const fileContent = await fs.readFile(change.sourcePath, 'utf-8');
        
        await debugLogger.log('Creating blob for file');
        const blob = await octokit.git.createBlob({
          owner: effectiveOwner,
          repo,
          content: fileContent,
          encoding: 'utf-8'
        });

        trees.push({
          path: change.path,
          mode: '100644' as '100644',
          type: 'blob' as 'blob',
          sha: blob.data.sha
        });
        await debugLogger.log('Added file to tree:', { path: change.path, sha: blob.data.sha });
      }
    }

    // Create a new tree
    await debugLogger.log('Creating new tree');
    const tree = await octokit.git.createTree({
      owner: effectiveOwner,
      repo,
      base_tree: latestCommit.data.tree.sha,
      tree: trees
    });
    await debugLogger.log('Created tree:', { sha: tree.data.sha });

    // Create the commit
    const commitParams: any = {
      owner: effectiveOwner,
      repo,
      message,
      tree: tree.data.sha,
      parents: [ref.data.object.sha]
    };

    if (author) {
      commitParams.author = author;
    }

    if (sign) {
      commitParams.sign = true;
    }

    await debugLogger.log('Creating commit with params:', { commitParams });
    const newCommit = await octokit.git.createCommit(commitParams);
    await debugLogger.log('Created commit:', { sha: newCommit.data.sha });

    // Update the reference
    await debugLogger.log('Updating branch reference');
    await octokit.git.updateRef({
      owner: effectiveOwner,
      repo,
      ref: `heads/${branch}`,
      sha: newCommit.data.sha
    });
    await debugLogger.log('Updated branch reference');

    // Clear project changes after successful commit
    if (newCommit.data && newCommit.data.sha) {
      await debugLogger.log('Commit successful, preparing to clear changes:', { 
        sha: newCommit.data.sha,
        hasNotifyDevHub: !!notifyDevHub,
        notifyDevHubType: typeof notifyDevHub
      });

      try {
        // First verify the commit exists
        await debugLogger.log('Verifying commit exists');
        await octokit.git.getCommit({
          owner: effectiveOwner,
          repo,
          commit_sha: newCommit.data.sha
        });
        
        // Then clear project changes
        if (notifyDevHub) {
          await debugLogger.log('Calling notifyDevHub to clear changes:', {
            repo,
            sha: newCommit.data.sha,
            notifyDevHubFunction: notifyDevHub.toString()
          });

          await notifyDevHub(repo, newCommit.data.sha);
          await debugLogger.log('Successfully cleared changes for commit');
        } else {
          await debugLogger.log('No notifyDevHub function provided');
        }
      } catch (error: any) {
        await debugLogger.log('Failed to clear project changes:', {
          error: error.toString(),
          errorMessage: error.message,
          errorStack: error.stack
        });
        return createResponse({
          commit: newCommit.data,
          warning: 'Commit successful but failed to clear project changes'
        });
      }
    } else {
      await debugLogger.log('Invalid commit response:', { newCommit });
      throw new McpError(ErrorCode.InternalError, 'Invalid commit response from GitHub');
    }

    return createResponse(newCommit.data);
  } catch (error: any) {
    await debugLogger.log('Create commit error:', { 
      error,
      errorMessage: error.message,
      errorStack: error.stack
    });
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to create commit: ${error.message}`
    );
  }
}

export async function handleListCommits(
  githubService: GitHubService,
  args: Record<string, unknown> | undefined
): Promise<ToolResponse> {
  if (!args) throw new Error('Arguments are required');
  const { owner, repo, branch, author, since, until, path } = args;
  await debugLogger.log('Listing commits:', { owner, repo, branch, author, since, until, path });

  try {
    const octokit = githubService.getOctokitForOwner(owner as string | undefined);
    const effectiveOwner = githubService.getEffectiveOwner(owner as string | undefined);

    const commits = await octokit.repos.listCommits({
      owner: effectiveOwner,
      repo: repo as string,
      sha: branch as string,
      author: author as string,
      since: since as string,
      until: until as string,
      path: path as string
    });

    return createResponse(commits.data);
  } catch (error: any) {
    await debugLogger.log('List commits error:', { error });
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to list commits: ${error.message}`
    );
  }
}

export async function handleGetCommit(
  githubService: GitHubService,
  args: Record<string, unknown> | undefined
): Promise<ToolResponse> {
  if (!args) throw new Error('Arguments are required');
  const { owner, repo, commit_sha } = args;
  await debugLogger.log('Getting commit:', { owner, repo, commit_sha });

  try {
    const octokit = githubService.getOctokitForOwner(owner as string | undefined);
    const effectiveOwner = githubService.getEffectiveOwner(owner as string | undefined);

    const [commit, files] = await Promise.all([
      octokit.git.getCommit({
        owner: effectiveOwner,
        repo: repo as string,
        commit_sha: commit_sha as string
      }),
      octokit.repos.getCommit({
        owner: effectiveOwner,
        repo: repo as string,
        ref: commit_sha as string
      })
    ]);

    return createResponse({
      commit: commit.data,
      files: files.data.files
    });
  } catch (error: any) {
    await debugLogger.log('Get commit error:', { error });
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to get commit: ${error.message}`
    );
  }
}

export async function handleRevertCommit(
  githubService: GitHubService,
  args: Record<string, unknown> | undefined
): Promise<ToolResponse> {
  if (!args) throw new Error('Arguments are required');
  const { owner, repo, commit_sha, message, branch = 'main' } = args;
  await debugLogger.log('Reverting commit:', { owner, repo, commit_sha, message, branch });

  try {
    const octokit = githubService.getOctokitForOwner(owner as string | undefined);
    const effectiveOwner = githubService.getEffectiveOwner(owner as string | undefined);

    // Get the commit to revert
    const commitToRevert = await octokit.git.getCommit({
      owner: effectiveOwner,
      repo: repo as string,
      commit_sha: commit_sha as string
    });

    // Get the current branch ref
    const ref = await octokit.git.getRef({
      owner: effectiveOwner,
      repo: repo as string,
      ref: `heads/${branch}`
    });

    // Create a new tree that reverses the changes
    const parentTree = await octokit.git.getTree({
      owner: effectiveOwner,
      repo: repo as string,
      tree_sha: commitToRevert.data.parents[0].sha
    });

    // Create the revert commit
    const revertCommit = await octokit.git.createCommit({
      owner: effectiveOwner,
      repo: repo as string,
      message: message as string,
      tree: parentTree.data.sha,
      parents: [ref.data.object.sha]
    });

    // Update the branch reference
    await octokit.git.updateRef({
      owner: effectiveOwner,
      repo: repo as string,
      ref: `heads/${branch}`,
      sha: revertCommit.data.sha
    });

    return createResponse(revertCommit.data);
  } catch (error: any) {
    await debugLogger.log('Revert commit error:', { error });
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to revert commit: ${error.message}`
    );
  }
}

export const commitTools = [
  {
    name: 'create_commit',
    description: 'Create a commit with multiple changes',
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
        message: {
          type: 'string',
          description: 'Commit message'
        },
        changes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'File path in repository'
              },
              sourcePath: {
                type: 'string',
                description: 'Local file path to read content from (required for add/modify)'
              },
              operation: {
                type: 'string',
                enum: ['add', 'modify', 'delete'],
                description: 'Operation to perform'
              }
            },
            required: ['path', 'operation']
          }
        },
        author: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Author name'
            },
            email: {
              type: 'string',
              description: 'Author email'
            }
          }
        },
        sign: {
          type: 'boolean',
          description: 'Whether to sign the commit'
        }
      },
      required: ['repo', 'branch', 'message', 'changes']
    }
  },
  {
    name: 'list_commits',
    description: 'List commits for a repository',
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
        author: {
          type: 'string',
          description: 'Filter by author'
        },
        since: {
          type: 'string',
          description: 'ISO 8601 date - only commits after this date'
        },
        until: {
          type: 'string',
          description: 'ISO 8601 date - only commits before this date'
        },
        path: {
          type: 'string',
          description: 'Only commits containing this file path'
        }
      },
      required: ['repo']
    }
  },
  {
    name: 'get_commit',
    description: 'Get detailed information about a specific commit',
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
        commit_sha: {
          type: 'string',
          description: 'Commit SHA'
        }
      },
      required: ['repo', 'commit_sha']
    }
  },
  {
    name: 'revert_commit',
    description: 'Revert changes from a specific commit',
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
        commit_sha: {
          type: 'string',
          description: 'SHA of commit to revert'
        },
        message: {
          type: 'string',
          description: 'Commit message for the revert'
        },
        branch: {
          type: 'string',
          description: 'Branch name'
        }
      },
      required: ['repo', 'commit_sha', 'message']
    }
  }
];