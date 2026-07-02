import * as https from 'https';
import { Logger, LogLevel } from '@modules/monitoring';
import type {
  RegistryAdapter,
  SearchParams,
  SearchResult,
  ServerDetail,
  ServerInstallConfig,
  ThirdPartyRegistry,
} from '../types';

const logger = new Logger({
  module: 'services:mcp:smitheryAdapter',
  level: LogLevel.INFO,
});

const SMITHERY_API_BASE = 'https://registry.smithery.ai/api/v1';

interface SmitheryServer {
  qualifiedName: string;
  name: string;
  description: string;
  displayName?: string;
  author?: string;
  tags?: string[];
  stars?: number;
  downloads?: number;
  updatedAt?: string;
  version?: string;
  homepage?: string;
  repository?: string;
  license?: string;
  installConfig?: {
    command: string;
    args: string[];
    env?: Record<string, string>;
  };
  tools?: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }>;
  env?: Array<{
    key: string;
    description: string;
    required: boolean;
    default?: string;
  }>;
}

export class SmitheryRegistryAdapter implements RegistryAdapter {
  readonly id = 'smithery';
  readonly registryType = 'third_party' as const;
  readonly sourceRegistry: ThirdPartyRegistry = 'smithery';
  readonly displayName = 'Smithery';
  private timeout = 10000;

  async search(params: SearchParams): Promise<SearchResult[]> {
    try {
      const query = params.query || '';
      const url = `${SMITHERY_API_BASE}/packages/search?q=${encodeURIComponent(query)}&limit=20`;
      const data = await this.httpGet(url);

      if (!data || !Array.isArray(data)) {
        return [];
      }

      return (data as SmitheryServer[]).map((server) => ({
        server: {
          name: server.qualifiedName || server.name,
          title: server.displayName || server.name,
          description: server.description || '',
          registry: 'third_party' as const,
          sourceRegistry: 'smithery' as ThirdPartyRegistry,
          author: server.author || 'unknown',
          categories: server.tags || [],
          isOfficial: false,
          installTypes: ['npm', 'docker', 'binary'],
          rating: Math.min(
            5,
            ((server.stars || 0) + (server.downloads || 0)) / 500
          ),
          installCount: server.downloads || server.stars || 0,
          lastUpdated: server.updatedAt || '',
          protocolVersion: '2025-11-25',
        },
        score: (server.stars || 0) * 2 + Math.log2((server.downloads || 0) + 1),
      }));
    } catch (error) {
      logger.warn('Smithery 搜索失败', error as Error);
      return [];
    }
  }

  async getServerDetail(serverId: string): Promise<ServerDetail | null> {
    try {
      const url = `${SMITHERY_API_BASE}/packages/${encodeURIComponent(serverId)}`;
      const data = await this.httpGet(url);

      if (!data) {
        return null;
      }

      const server = data as SmitheryServer;

      return {
        name: server.qualifiedName || server.name,
        title: server.displayName || server.name,
        description: server.description || '',
        registry: 'third_party',
        sourceRegistry: 'smithery',
        author: server.author || 'unknown',
        categories: server.tags || [],
        isOfficial: false,
        installTypes: ['npm', 'docker', 'binary'],
        rating: Math.min(
          5,
          ((server.stars || 0) + (server.downloads || 0)) / 500
        ),
        installCount: server.downloads || server.stars || 0,
        lastUpdated: server.updatedAt || '',
        protocolVersion: '2025-11-25',
        readme: '',
        tools: (server.tools || []).map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema || {},
        })),
        requiredEnv: (server.env || []).map((e) => ({
          name: e.key,
          description: e.description,
          required: e.required,
          defaultValue: e.default,
        })),
        exampleConfig: {},
        license: server.license || '',
        repository: server.repository || server.homepage || '',
        knownIssues: [],
      };
    } catch (error) {
      logger.warn(`获取 Smithery 服务器详情失败: ${serverId}`, error as Error);
      return null;
    }
  }

  async getCategories(): Promise<
    Array<{ id: string; name: string; count: number }>
  > {
    return [];
  }

  async buildInstallConfig(
    serverId: string
  ): Promise<ServerInstallConfig | null> {
    const detail = await this.getServerDetail(serverId);

    if (!detail) {
      return null;
    }

    return {
      name: detail.name,
      command: 'npx',
      args: ['-y', `@smithery/cli@latest`, 'run', serverId, '--config'],
      env: {},
    };
  }

  private httpGet(url: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const req = https.get(
        url,
        {
          timeout: this.timeout,
          headers: {
            'User-Agent': 'Liri-MCPMarketplace/1.0',
            Accept: 'application/json',
          },
        },
        (res) => {
          const chunks: Buffer[] = [];

          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf-8');

            if (
              res.statusCode &&
              res.statusCode >= 200 &&
              res.statusCode < 300
            ) {
              try {
                resolve(JSON.parse(body));
              } catch {
                resolve(null);
              }
            } else {
              resolve(null);
            }
          });
        }
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('请求超时'));
      });
    });
  }
}
