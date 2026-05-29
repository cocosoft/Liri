import { http } from './httpClient';

export type ThirdPartyRegistry = 'github' | 'npm' | 'smithery' | 'manual';

export type RegistryType = 'official' | 'third_party';

export type MCPSource = 'builtin' | 'official' | 'third_party';

export interface MCPServerSummary {
  name: string;
  title: string;
  description: string;
  registry: RegistryType;
  sourceRegistry?: ThirdPartyRegistry;
  author: string;
  categories: string[];
  isOfficial: boolean;
  installTypes: string[];
  rating: number;
  installCount: number;
  lastUpdated: string;
  protocolVersion: string;
}

export interface ServerToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ServerDetail extends MCPServerSummary {
  readme: string;
  tools: ServerToolDef[];
  requiredEnv: Array<{ name: string; description: string; required: boolean; defaultValue?: string }>;
  exampleConfig: Record<string, unknown>;
  license: string;
  repository: string;
  knownIssues: string[];
}

export interface SearchResult {
  server: MCPServerSummary;
  score?: number;
}

export interface InstalledMCPServer {
  name: string;
  title: string;
  installedFrom: MCPSource;
  sourceRegistry?: ThirdPartyRegistry;
  installedAt: number;
  updatedAt: number;
  version: string;
  enabled: boolean;
  autoUpdate: boolean;
  connected?: boolean;
  configInFile?: boolean;
}

export interface MCPCategory {
  id: string;
  name: string;
  count: number;
}

class MCPMarketplaceService {
  async search(params: {
    query?: string;
    category?: string;
    registry?: RegistryType;
    sourceRegistry?: ThirdPartyRegistry;
  }): Promise<SearchResult[]> {
    const queryParams: Record<string, unknown> = {};
    if (params.query) queryParams.query = params.query;
    if (params.category) queryParams.category = params.category;
    if (params.registry) queryParams.registry = params.registry;
    if (params.sourceRegistry) queryParams.sourceRegistry = params.sourceRegistry;

    return http.get<SearchResult[]>('/v1/mcp/marketplace/search', { params: queryParams });
  }

  async getCategories(): Promise<MCPCategory[]> {
    return http.get<MCPCategory[]>('/v1/mcp/marketplace/categories');
  }

  async getServerDetail(serverId: string): Promise<ServerDetail | null> {
    return http.get<ServerDetail | null>(`/v1/mcp/marketplace/servers/${encodeURIComponent(serverId)}`);
  }

  async getInstalledServers(): Promise<InstalledMCPServer[]> {
    return http.get<InstalledMCPServer[]>('/v1/mcp/marketplace/installed');
  }

  async install(serverId: string): Promise<{ success: boolean; serverId: string }> {
    return http.post<{ success: boolean; serverId: string }>(
      `/v1/mcp/marketplace/servers/${encodeURIComponent(serverId)}/install`
    );
  }

  async uninstall(serverId: string): Promise<{ success: boolean; serverId: string }> {
    return http.post<{ success: boolean; serverId: string }>(
      `/v1/mcp/marketplace/servers/${encodeURIComponent(serverId)}/uninstall`
    );
  }

  async toggleServer(serverId: string, enabled: boolean): Promise<{ success: boolean; serverId: string }> {
    return http.post<{ success: boolean; serverId: string }>(
      `/v1/mcp/marketplace/servers/${encodeURIComponent(serverId)}/toggle`,
      { enabled }
    );
  }
}

export const mcpMarketplaceService = new MCPMarketplaceService();
