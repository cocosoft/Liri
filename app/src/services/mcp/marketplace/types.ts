/**
 * 第三方注册表类型（用于标注具体来源，不影响宏观分类）
 */
export type ThirdPartyRegistry = 'github' | 'npm' | 'smithery' | 'manual';

/**
 * MCP 注册表宏观分类（公开 API 层）
 * 所有第三方市场统一归为 third_party，通过 ThirdPartyRegistry 标注具体来源
 */
export type RegistryType = 'official' | 'third_party';

/**
 * MCP 服务器安装来源（记录到本地存储）
 */
export type MCPSource = 'builtin' | 'official' | 'third_party';

/**
 * MCP 服务器概要信息
 */
export interface MCPServerSummary {
  name: string;
  title: string;
  description: string;
  registry: RegistryType;
  sourceRegistry?: ThirdPartyRegistry;
  author: string;
  categories: string[];
  isOfficial: boolean;
  installTypes: Array<'npm' | 'pypi' | 'docker' | 'binary'>;
  rating: number;
  installCount: number;
  lastUpdated: string;
  protocolVersion: string;
}

export interface ServerDetail extends MCPServerSummary {
  readme: string;
  tools: ServerToolDef[];
  requiredEnv: EnvVar[];
  exampleConfig: Record<string, unknown>;
  license: string;
  repository: string;
  knownIssues: string[];
}

export interface ServerToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface EnvVar {
  name: string;
  description: string;
  required: boolean;
  defaultValue?: string;
}

export interface SearchParams {
  query: string;
  category?: string;
  registry?: RegistryType;
  sourceRegistry?: ThirdPartyRegistry;
  page?: number;
  pageSize?: number;
}

export interface SearchResult {
  server: MCPServerSummary;
  score?: number;
}

export interface ServerInstallConfig {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
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
  config: ServerInstallConfig;
}

export interface MCPLocalStoreData {
  version: number;
  updatedAt: string;
  servers: Record<string, InstalledMCPServer>;
}

/**
 * 注册表适配器接口
 * - id: 内部唯一标识（如 'official', 'github', 'npm', 'smithery'）
 * - registryType: 公开分类（'official' | 'third_party'）
 * - sourceRegistry: 第三方注册表标注（仅 third_party 适配器需提供）
 */
export interface RegistryAdapter {
  readonly id: string;
  readonly registryType: RegistryType;
  readonly sourceRegistry?: ThirdPartyRegistry;
  readonly displayName: string;

  search(params: SearchParams): Promise<SearchResult[]>;
  getServerDetail(serverId: string): Promise<ServerDetail | null>;
  getCategories(): Promise<Array<{ id: string; name: string; count: number }>>;
  buildInstallConfig(serverId: string): Promise<ServerInstallConfig | null>;
}
