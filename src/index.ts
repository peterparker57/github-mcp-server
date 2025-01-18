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
import { debugLogger } from './utils/debug-logger.js';
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
    'github_projects.json'
  );

  private async loadProjects() {
    await debugLogger.log('Loading projects from:', { path: this.dataPath });
    try {
      const data = await fsPromises.readFile(this.dataPath, 'utf8');
      const { projects } = JSON.parse(data) as ProjectData;
      this.projects = new Map(projects.map(p => [p.name, p]));
      await debugLogger.log('Loaded projects:', { count: projects.length, projects });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        await debugLogger.log('No existing projects file found, initializing with github-server project');
        // Initialize with github-server project
        this.projects = new Map([
          ['github-server', {
            name: 'github-server',
            path: 'c:/Users/John Hickey/Documents/Cline/MCP/github-server',
            type: 'mcp-server',
            description: 'GitHub MCP Server providing tools for repository and file management',
            repository: {
              owner: 'peterparker57',
              name: 'github-mcp-server'
            },
            changes: []
          }]
        ]);
        // Save initial project data
        await this.saveProjects();
      } else {
        await debugLogger.log('Error loading projects:', { error });
        throw error;
      }
    }
  }

  private async saveProjects() {
    await debugLogger.log('Saving projects:', {
      path: this.dataPath,
      projects: Array.from(this.projects.values())
    });
    
    try {
      const projects = Array.from(this.projects.values());
      
      await fsPromises.mkdir(join(process.env.USERPROFILE || '', 'AppData', 'Roaming', 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings'), { recursive: true });
      await fsPromises.writeFile(this.dataPath, JSON.stringify({ projects }, null, 2), 'utf8');
      
      await debugLogger.log('Successfully saved projects', { count: projects.length });
    } catch (error) {
      await debugLogger.log('Error saving projects:', { error });
      throw error;
    }
  }

  private async clearProjectChanges(repo: string, commitSha: string): Promise<void> {
    try {
      await debugLogger.log('clearProjectChanges called with:', { repo, commitSha });
      
      // Load latest projects data
      await this.loadProjects();
      
      // Find project by repository name (case-insensitive)
      await debugLogger.log('Searching for project with repository name:', {
        searchRepo: repo,
        allProjects: Array.from(this.projects.values()).map(p => ({
          projectName: p.name,
          repoName: p.repository?.name
        }))
      });

      const project = Array.from(this.projects.values()).find(p =>
        p.repository?.name?.toLowerCase() === repo.toLowerCase()
      );
      
      if (!project) {
        await debugLogger.log('No project found with repository name:', { repo });
        throw new Error(`No project found with repository name ${repo}`);
      }

      await debugLogger.log('Found project:', {
        name: project.name,
        currentChanges: project.changes,
        currentLastCommit: project.lastCommit
      });
      
      // Create a new project object with cleared changes
      const updatedProject = {
        ...project,
        changes: [], // Clear all changes
        lastCommit: commitSha // Update the lastCommit
      };
      
      // Update the project in the Map
      this.projects.set(project.name, updatedProject);
      
      await debugLogger.log('Updated project:', {
        name: project.name,
        newChanges: updatedProject.changes,
        newLastCommit: updatedProject.lastCommit
      });
      
      // Save changes to disk
      await this.saveProjects();
      
      await debugLogger.log('Successfully cleared changes and updated lastCommit');
    } catch (error) {
      await debugLogger.log('Failed to clear project changes:', { error });
      throw error; // Re-throw to be handled by commit handler
    }
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
            await debugLogger.log('Setting up clearProjectChanges for commit:', {
              hasProjects: !!this.projects,
              projectCount: this.projects.size,
              dataPath: this.dataPath,
              thisContext: Object.keys(this)
            });

            const boundClearProjectChanges = this.clearProjectChanges.bind(this);
            await debugLogger.log('Bound clearProjectChanges:', {
              isBound: boundClearProjectChanges.hasOwnProperty('prototype'),
              boundFunction: boundClearProjectChanges.toString(),
              boundThis: Object.keys(boundClearProjectChanges.call)
            });

            return await handleCreateCommit(
              this.githubService,
              args,
              boundClearProjectChanges
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
