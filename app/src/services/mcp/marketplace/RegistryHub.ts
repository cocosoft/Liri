import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import type {
  RegistryAdapter,
  RegistryType,
  SearchParams,
  SearchResult,
  ServerDetail,
  ServerInstallConfig,
  ThirdPartyRegistry,
  MCPSource,
} from './types';
import { OfficialRegistryAdapter } from './adapters/OfficialRegistryAdapter';
import { GitHubRegistryAdapter } from './adapters/GitHubRegistryAdapter';
import { SmitheryRegistryAdapter } from './adapters/SmitheryRegistryAdapter';
import { NPMRegistryAdapter } from './adapters/NPMRegistryAdapter';

const logger = new Logger({ level: LogLevel.INFO });

export class RegistryHub {
  private adapters: Map<string, RegistryAdapter> = new Map();

  constructor() {
    this.registerDefaultAdapters();
  }

  private registerDefaultAdapters(): void {
    this.registerAdapter(new OfficialRegistryAdapter());
    this.registerAdapter(new GitHubRegistryAdapter());
    this.registerAdapter(new SmitheryRegistryAdapter());
    this.registerAdapter(new NPMRegistryAdapter());
  }

  registerAdapter(adapter: RegistryAdapter): void {
    this.adapters.set(adapter.id, adapter);
    logger.info(`注册 MCP 注册表适配器: ${adapter.id} (${adapter.displayName})`);
  }

  unregisterAdapter(id: string): void {
    this.adapters.delete(id);
  }

  getAdapter(id: string): RegistryAdapter | undefined {
    return this.adapters.get(id);
  }

  getAdaptersByType(registryType: RegistryType): RegistryAdapter[] {
    return Array.from(this.adapters.values()).filter(
      (a) => a.registryType === registryType
    );
  }

  getAdaptersBySource(sourceRegistry: ThirdPartyRegistry): RegistryAdapter[] {
    return Array.from(this.adapters.values()).filter(
      (a) => a.sourceRegistry === sourceRegistry
    );
  }

  getAdapterNames(): string[] {
    return Array.from(this.adapters.keys());
  }

  getAdapters(): RegistryAdapter[] {
    return Array.from(this.adapters.values());
  }

  async search(params: SearchParams): Promise<SearchResult[]> {
    let targetAdapters: RegistryAdapter[];

    if (params.sourceRegistry) {
      targetAdapters = this.getAdaptersBySource(params.sourceRegistry);
    } else if (params.registry) {
      targetAdapters = this.getAdaptersByType(params.registry);
    } else {
      targetAdapters = Array.from(this.adapters.values());
    }

    if (targetAdapters.length === 0) {
      return [];
    }

    const results = await Promise.allSettled(
      targetAdapters.map((adapter) => adapter.search(params))
    );

    const allResults: SearchResult[] = [];
    const seen = new Set<string>();

    for (const result of results) {
      if (result.status === 'rejected') {
        logger.warn('注册表搜索失败', result.reason as Error);
        continue;
      }

      for (const item of result.value) {
        const key = `${item.server.registry}:${item.server.sourceRegistry || 'none'}:${item.server.name}`;

        if (!seen.has(key)) {
          seen.add(key);
          allResults.push(item);
        }
      }
    }

    allResults.sort((a, b) => {
      const scoreA = a.score || 0;
      const scoreB = b.score || 0;

      if (scoreA !== scoreB) return scoreB - scoreA;

      if (a.server.isOfficial !== b.server.isOfficial) {
        return a.server.isOfficial ? -1 : 1;
      }

      return b.server.installCount - a.server.installCount;
    });

    return allResults;
  }

  async getServerDetail(serverId: string): Promise<ServerDetail | null> {
    const results = await Promise.allSettled(
      Array.from(this.adapters.values()).map((adapter) =>
        adapter.getServerDetail(serverId)
      )
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        return result.value;
      }
    }

    return null;
  }

  async buildInstallConfig(serverId: string): Promise<ServerInstallConfig | null> {
    const results = await Promise.allSettled(
      Array.from(this.adapters.values()).map((adapter) =>
        adapter.buildInstallConfig(serverId)
      )
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        return result.value;
      }
    }

    return null;
  }

  async resolveInstallSource(serverId: string): Promise<{
    config: ServerInstallConfig | null;
    installedFrom: MCPSource;
    sourceRegistry?: ThirdPartyRegistry;
  }> {
    for (const adapter of this.adapters.values()) {
      const config = await adapter.buildInstallConfig(serverId).catch(() => null);

      if (config) {
        if (adapter.id === 'official') {
          return { config, installedFrom: 'official' };
        }

        return { config, installedFrom: 'third_party', sourceRegistry: adapter.sourceRegistry || 'manual' };
      }
    }

    return { config: null, installedFrom: 'third_party', sourceRegistry: 'manual' };
  }

  async getCategories(): Promise<Array<{ id: string; name: string; count: number }>> {
    const results = await Promise.allSettled(
      Array.from(this.adapters.values()).map((adapter) => adapter.getCategories())
    );

    const categoryMap = new Map<string, { id: string; name: string; count: number }>();

    for (const result of results) {
      if (result.status === 'rejected') continue;

      for (const cat of result.value) {
        const existing = categoryMap.get(cat.id);

        if (existing) {
          existing.count += cat.count;
        } else {
          categoryMap.set(cat.id, { ...cat });
        }
      }
    }

    return Array.from(categoryMap.values());
  }
}
