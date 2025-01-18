#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { promises as fsPromises } from 'fs';
import { join } from 'path';

interface Change {
  timestamp: string;
  description: string;
  files?: string[];
  type?: string;
  committed?: boolean;
}

interface Project {
  name: string;
  path: string;
  type: string;
  description: string;
  repository?: {
    owner: string;
    name: string;
  };
  status?: string;
  technologies?: string[];
  lastCommit?: string;
  changes?: Change[];
}

interface ProjectData {
  projects: Project[];
}

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
  private projects: Map<string, Project> = new Map();
  private dataPath: string = join(
    process.env.USERPROFILE || '',
    'AppData',
    'Roaming',
    'Code',
    'User',
    'globalStorage',
    'rooveterinaryinc.roo-cline',
    'settings',
    'devhub_projects.json'
  );

  private async loadProjects() {
    try {
      const data = await fsPromises.readFile(this.dataPath, 'utf8');
      const { projects } = JSON.parse(data) as ProjectData;
      this.projects = new Map(projects.map(p => [p.name, p]));
      console.error(`Loaded ${projects.length} projects from disk`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        console.error('No existing projects file found');
        this.projects = new Map();
      } else {
        console.error('Error loading projects:', error);
        throw error;
      }
    }
  }

  private async saveProjects() {
    try {
      const projects = Array.from(this.projects.values());
      console.error('Saving projects:', JSON.stringify(projects, null, 2));
      
      await fsPromises.mkdir(join(process.env.USERPROFILE || '', 'AppData', 'Roaming', 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings'), { recursive: true });
      await fsPromises.writeFile(this.dataPath, JSON.stringify({ projects }, null, 2), 'utf8');
      
      console.error(`Saved ${projects.length} projects to disk at ${this.dataPath}`);
    } catch (error) {
      console.error('Error saving projects:', error);
      throw error;
    }
  }

  private async clearProjectChanges(repo: string, commitSha: string): Promise<void> {
    console.error('clearProjectChanges called with:', { repo, commitSha });
    console.error('Current projects:', JSON.stringify(Array.from(this.projects.entries()), null, 2));

    // Find project by repository name (case-insensitive)
    console.error('Looking for project with repo:', repo);
    const project = Array.from(this.projects.values()).find(p => {
      console.error('Checking project:', p.name, 'with repo:', p.repository?.name);
      return p.repository?.name?.toLowerCase() === repo.toLowerCase();
    });
    if (!project) {
      console.error(`No project found with repository name ${repo}`);
      return;
    }

    console.error('Found project:', project);
    if (!project.changes) return;
    
    // Create a new project object with the updates (immutable update)
    const updatedProject = {
      ...project,
      changes: project.changes.map(change => ({ ...change, committed: true })).filter(change => !change.committed),
      lastCommit: commitSha
    };
    
    // Update the project in the Map with the new state
    this.projects.set(project.name, updatedProject);
    
    // Force a save to disk
    await this.saveProjects();
    console.error(`Updated project ${project.name} with new commit ${commitSha}`);
    console.error(`Cleared changes for project ${project.name} after commit ${commitSha}`);
  }

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

    // Initialize GitHub service with accounts and default owner (if provided)
    this.githubService = new GitHubServiceImpl(accounts, process.env.DEFAULT_OWNER);
    
    this.setupToolHandlers();
    
    // Set up error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.saveProjects();
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
    this.server.setRequestHandler(CallToolRequestSchema, async (request: { params: { name: string; arguments?: Record<string, unknown> } }) => {
      try {
        if (!request.params || typeof request.params !== 'object') {
          throw new McpError(ErrorCode.InvalidParams, 'Invalid request parameters');
        }

        const { name, arguments: args } = request.params;
        let result;

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
            return await handleCreateCommit(
              this.githubService,
              args,
              this.clearProjectChanges.bind(this)
            );
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
    try {
      // Load projects before starting server
      await this.loadProjects();
      console.error(`Projects loaded successfully: ${this.projects.size} projects`);
      console.error('Projects:', JSON.stringify(Array.from(this.projects.entries()), null, 2));

      // Start the server after projects are loaded
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      console.error('GitHub MCP server running on stdio');
    } catch (error) {
      console.error('Failed to start server:', error);
      throw error;
    }
  }
}

const server = new GitHubServer();
server.run().catch((error: Error) => console.error(error));
