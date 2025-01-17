#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import { GitHubServiceImpl, parseGitHubAccounts } from './services/github.js';
import { handleListAccounts, handleSelectAccount, accountTools } from './handlers/account.js';
import { handleCreateRepository, handleCloneRepository, handleRenameRepository, repositoryTools } from './handlers/repository.js';
import {
  handleCreateOrUpdateFile,
  handleGetFile,
  handleDeleteFile,
  handlePushFile,
  handlePullFile,
  handlePullDirectory,
  handleSyncDirectory,
  handleCompareFiles,
  fileTools
} from './handlers/file.js';
import { handleCreateCommit, handleListCommits, handleGetCommit, handleRevertCommit, commitTools } from './handlers/commit.js';
import { handleListRepository, listTools } from './handlers/list.js';
import { createResponse } from './types/index.js';

// Initialize GitHub accounts from environment variables
const accounts = parseGitHubAccounts();
if (accounts.length === 0) {
  throw new Error('No GitHub accounts configured. Set GITHUB_TOKEN_<id> and GITHUB_OWNER_<id> environment variables.');
}

class GitHubServer {
  private server: Server;
  private githubService: GitHubServiceImpl;

  constructor() {
    this.server = new Server(
      {
        name: 'github-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Initialize GitHub service with accounts and default owner
    this.githubService = new GitHubServiceImpl(accounts, process.env.DEFAULT_OWNER);
    
    this.setupToolHandlers();
    
    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    // Register all available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        ...accountTools,
        ...repositoryTools,
        ...fileTools,
        ...commitTools,
        ...listTools
      ]
    }));

    // Handle tool execution requests
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        if (!request.params || typeof request.params !== 'object') {
          throw new McpError(ErrorCode.InvalidParams, 'Invalid request parameters');
        }

        const { name, arguments: args } = request.params;

        switch (name) {
          // Account management
          case 'list_accounts':
            return await handleListAccounts(this.githubService);
          case 'select_account':
            return await handleSelectAccount(this.githubService, args || {});

          // Repository management
          case 'create_repository':
            return await handleCreateRepository(this.githubService, args);
          case 'clone_repository':
            return await handleCloneRepository(this.githubService, args);
          case 'rename_repository':
            return await handleRenameRepository(this.githubService, args);
          case 'list_repository':
            return await handleListRepository(this.githubService, args);

          // File operations
          case 'pull_file':
            return await handlePullFile(this.githubService, args);
          case 'pull_directory':
            return await handlePullDirectory(this.githubService, args);
          case 'sync_directory':
            return await handleSyncDirectory(this.githubService, args);
          case 'compare_files':
            return await handleCompareFiles(this.githubService, args);
          case 'push_file':
            return await handlePushFile(this.githubService, args);
          case 'create_or_update_file':
            return await handleCreateOrUpdateFile(this.githubService, args);
          case 'get_file':
            return await handleGetFile(this.githubService, args);
          case 'delete_file':
            return await handleDeleteFile(this.githubService, args);

          // Commit operations
          case 'create_commit':
            return await handleCreateCommit(this.githubService, args);
          case 'list_commits':
            return await handleListCommits(this.githubService, args);
          case 'get_commit':
            return await handleGetCommit(this.githubService, args);
          case 'revert_commit':
            return await handleRevertCommit(this.githubService, args);

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error: any) {
        if (error instanceof McpError) throw error;
        
        console.error('GitHub API Error:', error);
        return createResponse(error.message, true);
      }
    });
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('GitHub MCP server running on stdio');
  }
}

const server = new GitHubServer();
server.run().catch((error: Error) => console.error(error));
