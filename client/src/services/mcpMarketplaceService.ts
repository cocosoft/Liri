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

export type MCPTransport = 'http' | 'stdio' | 'unknown';

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
  transport?: MCPTransport;
  toolCount?: number;
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

  /**
   * 验证服务器连接
   */
  async verifyServer(serverId: string): Promise<{ success: boolean; connected: boolean; status: string; error?: string }> {
    return http.post<{ success: boolean; connected: boolean; status: string; error?: string }>(
      `/v1/mcp/servers/${encodeURIComponent(serverId)}/verify`
    );
  }

  /**
   * 获取所有服务器工具列表
   */
  async listTools(): Promise<{
    tools: Array<{ name: string; description: string; server: string; inputSchema: Record<string, unknown>; enabled: boolean }>;
    total: number;
  }> {
    return http.get<{
      tools: Array<{ name: string; description: string; server: string; inputSchema: Record<string, unknown>; enabled: boolean }>;
      total: number;
    }>('/v1/mcp/tools');
  }

  /**
   * 切换工具启用/禁用
   */
  async toggleTool(toolName: string, enabled: boolean, server?: string): Promise<{ success: boolean; tool: string; enabled: boolean }> {
    return http.patch<{ success: boolean; tool: string; enabled: boolean }>(
      `/v1/mcp/tools/${encodeURIComponent(toolName)}/toggle`,
      { enabled, server }
    );
  }

  /** 获取可用第三方注册表源列表 */
  async getRegistries(): Promise<Array<{ id: string; name: string; sourceRegistry: string }>> {
    const res = await http.get<{ registries: Array<{ id: string; name: string; sourceRegistry: string }> }>(
      '/v1/mcp/marketplace/registries'
    );
    return res.registries || [];
  }
}

export const mcpMarketplaceService = new MCPMarketplaceService();
