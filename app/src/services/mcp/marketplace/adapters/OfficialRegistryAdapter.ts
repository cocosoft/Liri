import * as http from 'http';
import * as https from 'https';
import { Logger, LogLevel } from '@modules/monitoring';
import {
  getOfficialServers,
  getOfficialServersByCategory,
} from '@modules/services/mcp/MCPOfficialRegistry';
import type {
  RegistryAdapter,
  SearchParams,
  SearchResult,
  ServerDetail,
  ServerInstallConfig,
} from '../types';

const logger = new Logger({ level: LogLevel.INFO });

const OFFICIAL_REGISTRY_API = 'https://registry.modelcontextprotocol.io/v0';

export class OfficialRegistryAdapter implements RegistryAdapter {
  readonly id = 'official';
  readonly registryType = 'official' as const;
  readonly displayName = '官方注册表';
  private timeout = 10000;

  async search(params: SearchParams): Promise<SearchResult[]> {
    try {
      const query = params.query?.toLowerCase() || '';
      const localServers = getOfficialServers();
      const filtered = localServers.filter((s) => {
        const matchQuery =
          !query ||
          s.name.toLowerCase().includes(query) ||
          s.description?.toLowerCase().includes(query);

        const matchCategory =
          !params.category || s.category === params.category;

        return matchQuery && matchCategory;
      });

      const results: SearchResult[] = filtered.map((s) => ({
        server: {
          name: s.name,
          title: s.name,
          description: s.description || '',
          registry: 'official',
          author: 'official',
          categories: [s.category].filter(Boolean),
          isOfficial: true,
          installTypes: ['npm'],
          rating: 0,
          installCount: 0,
          lastUpdated: '',
          protocolVersion: '2025-11-25',
        },
        score: 0,
      }));

      return results;
    } catch (error) {
      logger.warn('官方注册表搜索失败，使用本地缓存', error as Error);
      return [];
    }
  }

  async getServerDetail(serverId: string): Promise<ServerDetail | null> {
    try {
      const servers = getOfficialServers();
      const server = servers.find((s) => s.name === serverId);

      if (!server) {
        return null;
      }

      return {
        name: server.name,
        title: server.name,
        description: server.description || '',
        registry: 'official',
        author: 'official',
        categories: [server.category].filter(Boolean),
        isOfficial: true,
        installTypes: ['npm'],
        rating: 0,
        installCount: 0,
        lastUpdated: '',
        protocolVersion: '2025-11-25',
        readme: '',
        tools: [],
        requiredEnv: [],
        exampleConfig: {},
        license: '',
        repository: '',
        knownIssues: [],
      };
    } catch (error) {
      logger.warn(`获取服务器详情失败: ${serverId}`, error as Error);
      return null;
    }
  }

  async getCategories(): Promise<
    Array<{ id: string; name: string; count: number }>
  > {
    const servers = getOfficialServers();
    const categoryMap = new Map<string, number>();

    for (const server of servers) {
      if (server.category) {
        categoryMap.set(
          server.category,
          (categoryMap.get(server.category) || 0) + 1
        );
      }
    }

    return Array.from(categoryMap.entries()).map(([id, count]) => ({
      id,
      name: id,
      count,
    }));
  }

  async buildInstallConfig(
    serverId: string
  ): Promise<ServerInstallConfig | null> {
    const servers = getOfficialServers();
    const server = servers.find((s) => s.name === serverId);

    if (!server) {
      return null;
    }

    if (server.command && server.args) {
      return {
        name: server.name,
        command: server.command,
        args: server.args,
        env: {},
      };
    }

    return {
      name: server.name,
      command: 'npx',
      args: ['-y', `@modelcontextprotocol/server-${server.name}`],
      env: {},
    };
  }
}
