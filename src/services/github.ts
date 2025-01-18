import { Octokit } from '@octokit/rest';
import { GitHubAccount, GitHubService } from '../types/index.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

export class GitHubServiceImpl implements GitHubService {
  private octokitInstances: Map<string, Octokit>;
  selectedOwner: string | undefined = undefined;
  callMcpTool?: ((serverName: string, toolName: string, args: Record<string, unknown>) => Promise<unknown>) | undefined;

  constructor(accounts: GitHubAccount[], defaultOwner?: string) {
    if (accounts.length === 0) {
      throw new Error('No GitHub accounts configured');
    }

    this.octokitInstances = new Map();
    for (const account of accounts) {
      this.octokitInstances.set(account.owner.toLowerCase(), new Octokit({
        auth: account.token,
      }));
      console.error(`Initialized GitHub account for owner: ${account.owner}`);
    }

    if (defaultOwner) {
      if (this.octokitInstances.has(defaultOwner.toLowerCase())) {
        this.selectedOwner = defaultOwner;
        console.error(`Using default owner: ${this.selectedOwner}`);
      } else {
        console.error(`Warning: Default owner ${defaultOwner} not found in configured accounts`);
      }
    }
  }

  getEffectiveOwner(owner?: string): string {
    const effectiveOwner = owner || this.selectedOwner;
    if (!effectiveOwner) {
      const availableOwners = this.listAccounts().join(', ');
      throw new McpError(
        ErrorCode.InvalidParams,
        `No owner selected. Use list_accounts to see available accounts and select_account to choose one. Available owners: ${availableOwners}`
      );
    }
    return effectiveOwner;
  }

  getOctokitForOwner(owner?: string): Octokit {
    const effectiveOwner = this.getEffectiveOwner(owner);
    const octokit = this.octokitInstances.get(effectiveOwner.toLowerCase());
    if (!octokit) {
      const availableOwners = this.listAccounts().join(', ');
      throw new McpError(
        ErrorCode.InvalidParams,
        `No GitHub token configured for owner: ${effectiveOwner}. Available owners: ${availableOwners}`
      );
    }
    return octokit;
  }

  listAccounts(): string[] {
    return Array.from(this.octokitInstances.keys());
  }

  selectAccount(owner: string): void {
    if (!this.octokitInstances.has(owner.toLowerCase())) {
      const availableOwners = this.listAccounts().join(', ');
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid owner: ${owner}. Available owners: ${availableOwners}`
      );
    }
    this.selectedOwner = owner;
  }

  get octokit(): Octokit {
    return this.getOctokitForOwner();
  }
}

// Parse GitHub accounts from environment variables
export function parseGitHubAccounts(): GitHubAccount[] {
  const accounts: GitHubAccount[] = [];
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('GITHUB_TOKEN_')) {
      const id = key.replace('GITHUB_TOKEN_', '');
      const ownerKey = `GITHUB_OWNER_${id}`;
      const owner = process.env[ownerKey];
      
      if (value && owner) {
        accounts.push({ 
          owner,
          token: value 
        });
      }
    }
  }

  if (accounts.length === 0) {
    throw new Error('No GitHub accounts configured. Set GITHUB_TOKEN_<id> and GITHUB_OWNER_<id> environment variables.');
  }

  return accounts;
}