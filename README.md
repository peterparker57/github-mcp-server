# GitHub MCP Server

A Model Context Protocol (MCP) server providing GitHub integration capabilities. This server enables interaction with GitHub repositories through MCP tools, supporting operations like repository management, file operations, and commit handling.

## Features

- Account management and authentication
- Repository creation and management
- File operations (read, write, push, pull)
- Commit operations
- Directory synchronization
- Repository comparison and diffing

## Installation

`ash
npm install @modelcontextprotocol/server-github
`

## Configuration

Add the server to your MCP settings file (cline_mcp_settings.json):

`json
{
  "mcpServers": {
    "github": {
      "command": "node",
      "args": ["/path/to/github-mcp-server/dist/index.js"],
      "env": {
        "GITHUB_TOKEN_1": "your-github-token",
        "GITHUB_OWNER_1": "your-github-username"
      },
      "disabled": false,
      "alwaysAllow": []
    }
  }
}
`

## Available Tools

### Account Management

#### list_accounts
List available GitHub accounts configured in the server.

#### select_account
Select a GitHub account to use for subsequent operations.

### Repository Management

#### create_repository
Create a new GitHub repository.

`	ypescript
{
  owner?: string;        // Repository owner (optional if account selected)
  name: string;          // Repository name
  description: string;   // Repository description
  private?: boolean;     // Whether repository is private
}
`

#### clone_repository
Clone a GitHub repository to a local directory.

`	ypescript
{
  owner?: string;    // Repository owner
  repo: string;      // Repository name
  branch?: string;   // Branch name (default: main)
  outputDir: string; // Local directory to clone into
}
`

#### rename_repository
Rename an existing GitHub repository.

`	ypescript
{
  owner?: string;    // Repository owner
  repo: string;      // Current repository name
  new_name: string;  // New repository name
}
`

### File Operations

#### push_file
Push a file to a GitHub repository.

`	ypescript
{
  owner?: string;     // Repository owner
  repo: string;       // Repository name
  path: string;       // Target path in repository
  message: string;    // Commit message
  sourcePath: string; // Local file to push
}
`

#### pull_file
Pull a file from a GitHub repository.

`	ypescript
{
  owner?: string;     // Repository owner
  repo: string;       // Repository name
  path: string;       // File path in repository
  outputPath: string; // Local path to save file
}
`

#### sync_directory
Two-way sync between local and remote directories.

`	ypescript
{
  owner?: string;    // Repository owner
  repo: string;      // Repository name
  path: string;      // Directory path in repository
  localPath: string; // Local directory path
}
`

### Commit Operations

#### create_commit
Create a commit with multiple file changes.

`	ypescript
{
  owner?: string;    // Repository owner
  repo: string;      // Repository name
  branch: string;    // Branch name
  message: string;   // Commit message
  changes: Array<{
    path: string;       // File path in repository
    sourcePath: string; // Local file path (for add/modify)
    operation: 'add' | 'modify' | 'delete';
  }>;
}
`

#### list_commits
List commits for a repository.

`	ypescript
{
  owner?: string;    // Repository owner
  repo: string;      // Repository name
  branch?: string;   // Branch name
  author?: string;   // Filter by author
  since?: string;    // ISO 8601 date - commits after
  until?: string;    // ISO 8601 date - commits before
}
`

## Development

To build the server:

`ash
npm install
npm run build
`

## Environment Variables

- GITHUB_TOKEN_<N>: GitHub personal access token
- GITHUB_OWNER_<N>: GitHub username for the token
- DEFAULT_OWNER: Default GitHub account to use

Multiple accounts can be configured by incrementing N (1, 2, etc.).

## License

MIT
