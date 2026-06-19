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

const logger = new Logger({ level: LogLevel.INFO });

const NPM_REGISTRY_API = 'https://registry.npmjs.org';

interface NPMPackage {
  name: string;
  version: string;
  description: string;
  author?: { name: string } | string;
  keywords?: string[];
  license?: string;
  homepage?: string;
  repository?: { url: string };
  readme?: string;
  date?: string;
}

interface NPMSearchObject {
  package: NPMPackage;
  score: { final: number };
  searchScore: number;
}

interface NPMSearchResponse {
  objects: NPMSearchObject[];
  total: number;
}

export class NPMRegistryAdapter implements RegistryAdapter {
  readonly id = 'npm';
  readonly registryType = 'third_party' as const;
  readonly sourceRegistry: ThirdPartyRegistry = 'npm';
  readonly displayName = 'NPM';
  private timeout = 10000;

  async search(params: SearchParams): Promise<SearchResult[]> {
    try {
      const query = this.buildSearchQuery(params);
      const url = `${NPM_REGISTRY_API}/-/v1/search?text=${encodeURIComponent(query)}&size=20`;
      const data = await this.httpGet(url);

      if (!data || !(data as NPMSearchResponse).objects) {
        return [];
      }

      return (data as NPMSearchResponse).objects.map((obj) => ({
        server: {
          name: obj.package.name,
          title: obj.package.name,
          description: obj.package.description || '',
          registry: 'third_party' as const,
          sourceRegistry: 'npm' as ThirdPartyRegistry,
          author:
            typeof obj.package.author === 'string'
              ? obj.package.author
              : obj.package.author?.name || 'unknown',
          categories: obj.package.keywords || [],
          isOfficial: false,
          installTypes: ['npm'],
          rating: Math.min(5, obj.score.final * 5),
          installCount: Math.round(obj.searchScore * 1000),
          lastUpdated: obj.package.date || '',
          protocolVersion: '2025-11-25',
        },
        score: obj.score.final * 100,
      }));
    } catch (error) {
      logger.warn('NPM MCP 搜索失败', error as Error);
      return [];
    }
  }

  private buildSearchQuery(params: SearchParams): string {
    const parts = ['keywords:mcp-server', 'keywords:mcp'];

    if (params.query) {
      parts.unshift(params.query);
    }

    return parts.join(' ');
  }

  async getServerDetail(serverId: string): Promise<ServerDetail | null> {
    try {
      const url = `${NPM_REGISTRY_API}/${encodeURIComponent(serverId)}`;
      const data = await this.httpGet(url);

      if (!data) {
        return null;
      }

      const pkg = data as NPMPackage & { 'dist-tags'?: { latest: string } };

      return {
        name: pkg.name,
        title: pkg.name,
        description: pkg.description || '',
        registry: 'third_party',
        sourceRegistry: 'npm',
        author:
          typeof pkg.author === 'string'
            ? pkg.author
            : pkg.author?.name || 'unknown',
        categories: pkg.keywords || [],
        isOfficial: false,
        installTypes: ['npm'],
        rating: 3,
        installCount: 0,
        lastUpdated: pkg.date || '',
        protocolVersion: '2025-11-25',
        readme: pkg.readme || '',
        tools: [],
        requiredEnv: [],
        exampleConfig: {},
        license: pkg.license || '',
        repository:
          typeof pkg.repository === 'object' ? pkg.repository?.url || '' : '',
        knownIssues: [],
      };
    } catch (error) {
      logger.warn(`获取 NPM 包详情失败: ${serverId}`, error as Error);
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
    return {
      name: serverId,
      command: 'npx',
      args: ['-y', serverId],
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
