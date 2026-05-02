/**
 * MCP 官方注册表预取（基于CC源码 services/mcp/officialRegistry.ts）
 */

export interface OfficialMCPServer {
  name: string;
  displayName: string;
  description: string;
  category: string;
  url: string;
  transport: 'stdio' | 'sse' | 'http';
}

let cachedUrls: OfficialMCPServer[] | null = null;

export async function prefetchOfficialMcpUrls(): Promise<OfficialMCPServer[]> {
  if (cachedUrls) return cachedUrls;

  cachedUrls = [
    {
      name: 'filesystem',
      displayName: 'Filesystem',
      description: 'Secure file system access',
      category: 'development',
      url: 'https://modelcontextprotocol.io/servers/filesystem.json',
      transport: 'stdio',
    },
    {
      name: 'github',
      displayName: 'GitHub',
      description: 'GitHub repository and PR management',
      category: 'development',
      url: 'https://modelcontextprotocol.io/servers/github.json',
      transport: 'sse',
    },
    {
      name: 'postgres',
      displayName: 'PostgreSQL',
      description: 'PostgreSQL database access',
      category: 'database',
      url: 'https://modelcontextprotocol.io/servers/postgres.json',
      transport: 'stdio',
    },
  ];

  return cachedUrls;
}

export function getOfficialServers(): OfficialMCPServer[] {
  return cachedUrls || [];
}

export function getOfficialServersByCategory(category: string): OfficialMCPServer[] {
  return (cachedUrls || []).filter(s => s.category === category);
}

export function getOfficialServer(name: string): OfficialMCPServer | undefined {
  return (cachedUrls || []).find(s => s.name === name);
}

export function getCategories(): string[] {
  return [...new Set((cachedUrls || []).map(s => s.category))];
}
