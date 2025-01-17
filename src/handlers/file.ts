import { GitHubService, ToolResponse, FileOperation, createResponse, validateArgs } from '../types/index.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs/promises';

export async function handlePullFile(
  githubService: GitHubService,
  args: Record<string, unknown> | undefined
): Promise<ToolResponse> {
  validateArgs<FileOperation>(args, ['repo', 'path', 'outputPath']);
  const { owner, repo, path, outputPath, branch = 'main' } = args;
  const effectiveOwner = githubService.getEffectiveOwner(owner as string | undefined);
  console.error('Pulling file:', { owner: effectiveOwner, repo, path, outputPath, branch });

  try {
    // Get file content from GitHub
    const octokit = githubService.getOctokitForOwner(owner as string | undefined);
    const response = await octokit.repos.getContent({
      owner: effectiveOwner,
      repo: repo as string,
      path: path as string,
      ref: branch as string
    });

    if (!('content' in response.data)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid file data received'
      );
    }

    // Decode and write to local file
    const content = Buffer.from(response.data.content, 'base64').toString('utf8');
    await fs.writeFile(outputPath as string, content, 'utf-8');

    return createResponse({
      success: true,
      message: `File pulled successfully to ${outputPath}`
    });
  } catch (error: any) {
    console.error('Pull file error:', error);
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to pull file: ${error.message}`
    );
  }
}

export async function handlePullDirectory(
  githubService: GitHubService,
  args: Record<string, unknown> | undefined
): Promise<ToolResponse> {
  validateArgs<FileOperation>(args, ['repo', 'path', 'outputPath']);
  const { owner, repo, path, outputPath, branch = 'main', recursive = true } = args;
  const effectiveOwner = githubService.getEffectiveOwner(owner as string | undefined);
  console.error('Pulling directory:', { owner: effectiveOwner, repo, path, outputPath, branch });

  try {
    const octokit = githubService.getOctokitForOwner(owner as string | undefined);
    
    // Get directory contents
    const response = await octokit.repos.getContent({
      owner: effectiveOwner,
      repo: repo as string,
      path: path as string,
      ref: branch as string
    });

    if (!Array.isArray(response.data)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Path is not a directory'
      );
    }

    // Create output directory
    await fs.mkdir(outputPath as string, { recursive: true });

    // Process each file
    let processedFiles = 0;
    for (const item of response.data) {
      const itemPath = `${outputPath}/${item.name}`;
      
      if (item.type === 'file') {
        const fileResponse = await octokit.repos.getContent({
          owner: effectiveOwner,
          repo: repo as string,
          path: item.path,
          ref: branch as string
        });

        if ('content' in fileResponse.data) {
          const content = Buffer.from(fileResponse.data.content, 'base64').toString('utf8');
          await fs.writeFile(itemPath, content, 'utf-8');
          processedFiles++;
        }
      } else if (item.type === 'dir' && recursive) {
        await handlePullDirectory(githubService, {
          owner,
          repo,
          path: item.path,
          outputPath: itemPath,
          branch,
          recursive
        });
      }
    }

    return createResponse({
      success: true,
      message: `Directory pulled successfully to ${outputPath}`,
      processedFiles
    });
  } catch (error: any) {
    console.error('Pull directory error:', error);
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to pull directory: ${error.message}`
    );
  }
}

export async function handleSyncDirectory(
  githubService: GitHubService,
  args: Record<string, unknown> | undefined
): Promise<ToolResponse> {
  validateArgs<FileOperation>(args, ['repo', 'path', 'localPath']);
  const { owner, repo, path, localPath, branch = 'main' } = args;
  const effectiveOwner = githubService.getEffectiveOwner(owner as string | undefined);
  console.error('Syncing directory:', { owner: effectiveOwner, repo, path, localPath, branch });

  try {
    // First, pull remote changes
    await handlePullDirectory(githubService, {
      owner,
      repo,
      path,
      outputPath: localPath,
      branch
    });

    // Then, push local changes
    const localFiles = await fs.readdir(localPath as string, { withFileTypes: true });
    let processedFiles = 0;

    for (const file of localFiles) {
      if (file.isFile()) {
        const filePath = `${localPath}/${file.name}`;
        const content = await fs.readFile(filePath, 'utf-8');
        
        await handlePushFile(githubService, {
          owner,
          repo,
          path: `${path}/${file.name}`,
          message: `Sync: Update ${file.name}`,
          sourcePath: filePath,
          branch
        });
        
        processedFiles++;
      }
    }

    return createResponse({
      success: true,
      message: `Directory synced successfully`,
      processedFiles
    });
  } catch (error: any) {
    console.error('Sync directory error:', error);
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to sync directory: ${error.message}`
    );
  }
}

export async function handleCompareFiles(
  githubService: GitHubService,
  args: Record<string, unknown> | undefined
): Promise<ToolResponse> {
  validateArgs<FileOperation>(args, ['repo', 'path', 'localPath']);
  const { owner, repo, path, localPath, branch = 'main' } = args;
  const effectiveOwner = githubService.getEffectiveOwner(owner as string | undefined);
  console.error('Comparing files:', { owner: effectiveOwner, repo, path, localPath, branch });

  try {
    // Get remote content
    const octokit = githubService.getOctokitForOwner(owner as string | undefined);
    const response = await octokit.repos.getContent({
      owner: effectiveOwner,
      repo: repo as string,
      path: path as string,
      ref: branch as string
    });

    if (!('content' in response.data)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid remote file data'
      );
    }

    // Get local content
    const localContent = await fs.readFile(localPath as string, 'utf-8');
    const remoteContent = Buffer.from(response.data.content, 'base64').toString('utf8');

    // Compare contents
    const isDifferent = localContent !== remoteContent;
    
    return createResponse({
      isDifferent,
      message: isDifferent ? 'Files are different' : 'Files are identical',
      details: isDifferent ? {
        localSize: localContent.length,
        remoteSize: remoteContent.length,
        remoteSha: response.data.sha
      } : undefined
    });
  } catch (error: any) {
    console.error('Compare files error:', error);
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to compare files: ${error.message}`
    );
  }
}

export async function handlePushFile(
  githubService: GitHubService,
  args: Record<string, unknown> | undefined
): Promise<ToolResponse> {
  validateArgs<FileOperation>(args, ['repo', 'path', 'message', 'sourcePath']);
  const { owner, repo, path, message, sourcePath, branch = 'main' } = args;
  const effectiveOwner = githubService.getEffectiveOwner(owner as string | undefined);
  console.error('Pushing file:', { owner: effectiveOwner, repo, path, sourcePath, branch });

  try {
    // Read the source file
    const content = await fs.readFile(sourcePath as string, 'utf-8');
    
    // Use existing create/update logic with file content
    return handleCreateOrUpdateFile(githubService, {
      owner,
      repo,
      path,
      message,
      content,
      branch
    });
  } catch (error: any) {
    console.error('Push file error:', error);
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to push file: ${error.message}`
    );
  }
}

export async function handleCreateOrUpdateFile(
  githubService: GitHubService,
  args: Record<string, unknown> | undefined
): Promise<ToolResponse> {
  if (!args) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Arguments are required'
    );
  }
  if ('content' in args) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Direct content upload is not allowed. Use push_file with sourcePath instead.'
    );
  }
  validateArgs<FileOperation>(args, ['repo', 'path', 'message', 'sourcePath']);
  const { owner, repo, path, message, sourcePath, branch = 'main', sha: providedSha } = args;
  const effectiveOwner = githubService.getEffectiveOwner(owner as string | undefined);
  console.error('Creating/updating file:', { owner: effectiveOwner, repo, path, branch });

  try {
    const octokit = githubService.getOctokitForOwner(owner as string | undefined);
    
    // Read content from source file and convert to base64
    const fileContent = await fs.readFile(sourcePath as string, 'utf-8');
    const contentBase64 = Buffer.from(fileContent).toString('base64');

    // If no SHA provided, try to get it
    let sha = providedSha as string | undefined;
    if (!sha) {
      try {
        const fileData = await octokit.repos.getContent({
          owner: effectiveOwner,
          repo: repo as string,
          path: path as string,
          ref: branch as string
        });

        if ('sha' in fileData.data) {
          sha = fileData.data.sha;
          console.error(`Found existing file, got SHA: ${sha}`);
        }
      } catch (error: any) {
        if (error.status !== 404) throw error;
        console.error('File does not exist yet, creating new file');
      }
    }

    // Create or update the file
    const result = await octokit.repos.createOrUpdateFileContents({
      owner: effectiveOwner,
      repo: repo as string,
      path: path as string,
      message: message as string,
      content: contentBase64,
      branch: branch as string,
      ...(sha ? { sha } : {})
    });

    return createResponse(result.data);
  } catch (error: any) {
    console.error('Create/update file error:', error);
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to create/update file: ${error.message}`
    );
  }
}

type GetFileOperation = Pick<FileOperation, 'owner' | 'repo' | 'path' | 'branch'>;

export async function handleGetFile(
  githubService: GitHubService,
  args: Record<string, unknown> | undefined
): Promise<ToolResponse> {
  validateArgs<GetFileOperation>(args, ['repo', 'path']);
  const { owner, repo, path, branch = 'main' } = args;
  const effectiveOwner = githubService.getEffectiveOwner(owner as string | undefined);
  console.error('Getting file:', { owner: effectiveOwner, repo, path, branch });

  try {
    const octokit = githubService.getOctokitForOwner(owner as string | undefined);
    const response = await octokit.repos.getContent({
      owner: effectiveOwner,
      repo: repo as string,
      path: path as string,
      ref: branch as string
    });

    if (!('content' in response.data)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid file data received'
      );
    }

    // GitHub returns base64 encoded content
    const content = Buffer.from(response.data.content, 'base64').toString('utf8');
    return createResponse(content);
  } catch (error: any) {
    console.error('Get file error:', error);
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to get file: ${error.message}`
    );
  }
}

export async function handleDeleteFile(
  githubService: GitHubService,
  args: Record<string, unknown> | undefined
): Promise<ToolResponse> {
  validateArgs<FileOperation>(args, ['repo', 'path', 'message']);
  const { owner, repo, path, message, branch = 'main' } = args;
  const effectiveOwner = githubService.getEffectiveOwner(owner as string | undefined);
  console.error('Deleting file:', { owner: effectiveOwner, repo, path, branch });

  try {
    const octokit = githubService.getOctokitForOwner(owner as string | undefined);
    
    // Get the file's SHA first
    const fileData = await octokit.repos.getContent({
      owner: effectiveOwner,
      repo: repo as string,
      path: path as string,
      ref: branch as string
    });

    if (!('sha' in fileData.data)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid file data received'
      );
    }

    // Delete the file
    const response = await octokit.repos.deleteFile({
      owner: effectiveOwner,
      repo: repo as string,
      path: path as string,
      message: message as string,
      sha: fileData.data.sha,
      branch: branch as string
    });

    return createResponse(response.data);
  } catch (error: any) {
    console.error('Delete file error:', error);
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to delete file: ${error.message}`
    );
  }
}

export const fileTools = [
  {
    name: 'pull_file',
    description: 'Pull a file from GitHub to a local path',
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
        path: {
          type: 'string',
          description: 'File path in repository'
        },
        outputPath: {
          type: 'string',
          description: 'Local path to save the file'
        },
        branch: {
          type: 'string',
          description: 'Branch name'
        }
      },
      required: ['repo', 'path', 'outputPath']
    }
  },
  {
    name: 'pull_directory',
    description: 'Pull an entire directory from GitHub',
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
        path: {
          type: 'string',
          description: 'Directory path in repository'
        },
        outputPath: {
          type: 'string',
          description: 'Local path to save the directory'
        },
        branch: {
          type: 'string',
          description: 'Branch name'
        },
        recursive: {
          type: 'boolean',
          description: 'Whether to pull subdirectories recursively'
        }
      },
      required: ['repo', 'path', 'outputPath']
    }
  },
  {
    name: 'sync_directory',
    description: 'Two-way sync between local and remote directories',
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
        path: {
          type: 'string',
          description: 'Directory path in repository'
        },
        localPath: {
          type: 'string',
          description: 'Local directory path'
        },
        branch: {
          type: 'string',
          description: 'Branch name'
        }
      },
      required: ['repo', 'path', 'localPath']
    }
  },
  {
    name: 'compare_files',
    description: 'Compare local and remote versions of a file',
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
        path: {
          type: 'string',
          description: 'File path in repository'
        },
        localPath: {
          type: 'string',
          description: 'Local file path'
        },
        branch: {
          type: 'string',
          description: 'Branch name'
        }
      },
      required: ['repo', 'path', 'localPath']
    }
  },
  {
    name: 'push_file',
    description: 'Push an existing file to a GitHub repository',
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
        path: {
          type: 'string',
          description: 'Target path in repository'
        },
        message: {
          type: 'string',
          description: 'Commit message'
        },
        sourcePath: {
          type: 'string',
          description: 'Local file path to push'
        },
        branch: {
          type: 'string',
          description: 'Branch name'
        }
      },
      required: ['repo', 'path', 'message', 'sourcePath']
    }
  },
  {
    name: 'create_or_update_file',
    description: 'Create or update a file in a GitHub repository',
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
        path: {
          type: 'string',
          description: 'File path'
        },
        message: {
          type: 'string',
          description: 'Commit message'
        },
        sourcePath: {
          type: 'string',
          description: 'Local file path to read content from'
        },
        branch: {
          type: 'string',
          description: 'Branch name'
        },
        sha: {
          type: 'string',
          description: 'File SHA (required when updating existing files)'
        }
      },
      required: ['repo', 'path', 'message', 'sourcePath']
    }
  },
  {
    name: 'get_file',
    description: 'Get file content from a GitHub repository',
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
        path: {
          type: 'string',
          description: 'File path'
        },
        branch: {
          type: 'string',
          description: 'Branch name'
        }
      },
      required: ['repo', 'path']
    }
  },
  {
    name: 'delete_file',
    description: 'Delete a file from a GitHub repository',
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
        path: {
          type: 'string',
          description: 'File path to delete'
        },
        message: {
          type: 'string',
          description: 'Commit message'
        },
        branch: {
          type: 'string',
          description: 'Branch name'
        }
      },
      required: ['repo', 'path', 'message']
    }
  }
];