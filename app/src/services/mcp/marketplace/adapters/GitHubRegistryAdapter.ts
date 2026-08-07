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
  module: 'services:mcp:githubAdapter',
  level: LogLevel.INFO,
});

interface GitHubRepo {
  full_name: string;
  name: string;
  description: string;
  html_url: string;
  owner: { login: string; avatar_url: string };
  topics: string[];
  stargazers_count: number;
  updated_at: string;
  license: { spdx_id: string } | null;
  score: number;
}

interface GitHubSearchResponse {
  items: GitHubRepo[];
  total_count: number;
}

export class GitHubRegistryAdapter implements RegistryAdapter {
  readonly id = 'github';
  readonly registryType = 'third_party' as const;
  readonly sourceRegistry: ThirdPartyRegistry = 'github';
  readonly displayName = 'GitHub';
  private timeout = 10000;

  async search(params: SearchParams): Promise<SearchResult[]> {
    const cacheKey = `${params.query}|${params.category || ''}`;

    try {
      const searchQuery = this.buildSearchQuery(params);
      const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(searchQuery)}&sort=stars&per_page=20`;
      const data = (await this.httpGet(url)) as GitHubSearchResponse | null;

      if (!data?.items) {
        return [];
      }

      return this.parseResponse(data, cacheKey);
    } catch (error) {
      logger.warn('GitHub MCP 搜索失败', error as Error);
      return [];
    }
  }

  private buildSearchQuery(params: SearchParams): string {
    const parts = ['topic:mcp-server', 'topic:mcp-sdk'];

    if (params.query) {
      parts.unshift(params.query);
    }

    if (params.category) {
      parts.push(`topic:${params.category}`);
    }

    return parts.join(' ');
  }

  private parseResponse(
    data: GitHubSearchResponse,
    _cacheKey: string
  ): SearchResult[] {
    return (data.items || []).map((repo) => ({
      server: {
        name: repo.full_name,
        title: repo.name,
        description: repo.description || '',
        registry: 'third_party' as const,
        sourceRegistry: 'github' as ThirdPartyRegistry,
        author: repo.owner?.login || 'unknown',
        categories: repo.topics || [],
        isOfficial: false,
        installTypes: ['npm'],
        rating: Math.min(5, (repo.stargazers_count || 0) / 100),
        installCount: repo.stargazers_count || 0,
        lastUpdated: repo.updated_at || '',
        protocolVersion: '2025-11-25',
      },
      score: repo.score || 0,
    }));
  }

  async getServerDetail(serverId: string): Promise<ServerDetail | null> {
    try {
      const url = `https://api.github.com/repos/${serverId.replace('github:', '')}`;
      const data = (await this.httpGet(url)) as GitHubRepo | null;

      if (!data) {
        return null;
      }

      const repo = data;

      return {
        name: repo.full_name,
        title: repo.name,
        description: repo.description || '',
        registry: 'third_party',
        sourceRegistry: 'github',
        author: repo.owner?.login || 'unknown',
        categories: repo.topics || [],
        isOfficial: false,
        installTypes: ['npm'],
        rating: Math.min(5, (repo.stargazers_count || 0) / 100),
        installCount: repo.stargazers_count || 0,
        lastUpdated: repo.updated_at || '',
        protocolVersion: '2025-11-25',
        readme: `${repo.html_url}/blob/main/README.md`,
        tools: [],
        requiredEnv: [],
        exampleConfig: {},
        license: repo.license?.spdx_id || '',
        repository: repo.html_url,
        knownIssues: [],
      };
    } catch (error) {
      logger.warn(`获取 GitHub 服务器详情失败: ${serverId}`, error as Error);
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

    const pkgName = serverId.includes('/') ? serverId.split('/')[1] : serverId;

    return {
      name: pkgName,
      command: 'npx',
      args: [
        '-y',
        pkgName.startsWith('@')
          ? pkgName
          : `@modelcontextprotocol/server-${pkgName}`,
      ],
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
            Accept: 'application/vnd.github.v3+json',
          },
        },
        (res) => {
          const chunks: Buffer[] = [];

          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf-8');

            if (res.statusCode === 403) {
              logger.warn('GitHub API 速率限制');
              resolve(null);
              return;
            }

            if (
              res.statusCode &&
              res.statusCode >= 200 &&
              res.statusCode < 300
            ) {
              try {
                resolve(JSON.parse(body));
              } catch {
                // @ignore-catch — 响应体 JSON 解析失败 resolve(null)（非法响应降级，由调用方聚合处理）
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
