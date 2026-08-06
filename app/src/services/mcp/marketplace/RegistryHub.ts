import { Logger, LogLevel } from '@modules/monitoring';
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
import { RegistryPresetAdapter } from './adapters/RegistryPresetAdapter';

const logger = new Logger({
  module: 'services:mcp:registryHub',
  level: LogLevel.INFO,
});

export class RegistryHub {
  private adapters: Map<string, RegistryAdapter> = new Map();

  constructor(safeMode: boolean = false) {
    if (!safeMode) {
      this.registerDefaultAdapters();
    }
  }

  private registerDefaultAdapters(): void {
    try {
      this.registerAdapter(new OfficialRegistryAdapter());
    } catch (error) {
      logger.warn('注册官方注册表适配器失败', error as Error);
    }
    try {
      this.registerAdapter(new GitHubRegistryAdapter());
    } catch (error) {
      logger.warn('注册 GitHub 注册表适配器失败', error as Error);
    }
    try {
      this.registerAdapter(new SmitheryRegistryAdapter());
    } catch (error) {
      logger.warn('注册 Smithery 注册表适配器失败', error as Error);
    }
    try {
      this.registerAdapter(new NPMRegistryAdapter());
    } catch (error) {
      logger.warn('注册 NPM 注册表适配器失败', error as Error);
    }
    // 2026-08-06：预设主流 MCP 市场（无公开搜索 API，来源入口 + 手动安装）
    try {
      this.registerAdapter(
        new RegistryPresetAdapter('mcpso', 'MCP.so', 'mcpso', 'https://mcp.so/')
      );
      this.registerAdapter(
        new RegistryPresetAdapter(
          'mcpmarket',
          'MCPMarket.cn',
          'mcpmarket',
          'https://mcpmarket.cn/'
        )
      );
      this.registerAdapter(
        new RegistryPresetAdapter(
          'modelscope',
          '魔搭 MCP 广场',
          'modelscope',
          'https://modelscope.cn/mcp'
        )
      );
      this.registerAdapter(
        new RegistryPresetAdapter(
          'mcpmarketplaceio',
          'mcp-marketplace.io',
          'mcpmarketplaceio',
          'https://mcp-marketplace.io/'
        )
      );
      // mcpservers.org：Awesome MCP Servers 目录（无公开搜索 API，官网中文版入口）
      this.registerAdapter(
        new RegistryPresetAdapter(
          'mcpservers',
          'mcpservers.org',
          'mcpservers',
          'https://mcpservers.org/zh-CN/'
        )
      );
    } catch (error) {
      logger.warn('注册预设 MCP 市场适配器失败', error as Error);
    }
  }

  registerAdapter(adapter: RegistryAdapter): void {
    this.adapters.set(adapter.id, adapter);
    logger.info(
      `注册 MCP 注册表适配器: ${adapter.id} (${adapter.displayName})`
    );
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

  async buildInstallConfig(
    serverId: string
  ): Promise<ServerInstallConfig | null> {
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
      const config = await adapter
        .buildInstallConfig(serverId)
        .catch(() => null);

      if (config) {
        if (adapter.id === 'official') {
          return { config, installedFrom: 'official' };
        }

        return {
          config,
          installedFrom: 'third_party',
          sourceRegistry: adapter.sourceRegistry || 'manual',
        };
      }
    }

    return {
      config: null,
      installedFrom: 'third_party',
      sourceRegistry: 'manual',
    };
  }

  async getCategories(): Promise<
    Array<{ id: string; name: string; count: number }>
  > {
    const results = await Promise.allSettled(
      Array.from(this.adapters.values()).map((adapter) =>
        adapter.getCategories()
      )
    );

    const categoryMap = new Map<
      string,
      { id: string; name: string; count: number }
    >();

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
