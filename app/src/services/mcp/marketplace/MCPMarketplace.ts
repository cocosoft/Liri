import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { resolvePyappHome } from '@modules/config/paths';
import { enhancedMcpConfigManager } from '@modules/services/mcp/EnhancedMCPConfigManager';
import { getMCPServerManager } from '@modules/services/mcp/MCPServerManager';
import { LocalServerStore } from './LocalServerStore';
import { ConfigWriter } from './ConfigWriter';
import { RegistryHub } from './RegistryHub';
import type {
  SearchParams,
  SearchResult,
  ServerDetail,
  ServerInstallConfig,
  InstalledMCPServer,
  ThirdPartyRegistry,
} from './types';
import type { ScopedMcpServerConfig } from '@modules/services/mcp/types';
import { MCPServerStatus } from '@modules/services/mcp/types';

const logger = new Logger({ level: LogLevel.INFO });

export class MCPMarketplace {
  readonly store: LocalServerStore;
  readonly configWriter: ConfigWriter;
  readonly registryHub: RegistryHub;

  constructor() {
    const mcpHome = this.getMCPHome();
    this.store = new LocalServerStore(mcpHome);
    this.configWriter = new ConfigWriter();
    this.registryHub = new RegistryHub();
  }

  private getMCPHome(): string {
    const pyappHome = resolvePyappHome();
    const mcpDir = `${pyappHome}\\mcp`;

    return mcpDir;
  }

  /**
   * 搜索 MCP 服务器市场
   */
  async search(params: SearchParams): Promise<SearchResult[]> {
    return await this.registryHub.search(params);
  }

  /**
   * 获取服务器详情
   */
  async getServerDetail(serverId: string): Promise<ServerDetail | null> {
    return await this.registryHub.getServerDetail(serverId);
  }

  /**
   * 安装 MCP 服务器（写入配置 + 注册连接 + 启动连接）
   */
  async install(serverId: string): Promise<void> {
    if (this.store.isInstalled(serverId)) {
      throw new Error(`MCP 服务器 "${serverId}" 已安装`);
    }

    const { config, installedFrom, sourceRegistry } =
      await this.registryHub.resolveInstallSource(serverId);

    if (!config) {
      throw new Error(`无法为 "${serverId}" 生成安装配置`);
    }

    await this.configWriter.install(serverId, config);

    this.store.addServer({
      name: serverId,
      title: serverId,
      installedFrom,
      sourceRegistry,
      installedAt: Date.now(),
      updatedAt: Date.now(),
      version: 'latest',
      enabled: true,
      autoUpdate: false,
      config,
    });

    const manager = getMCPServerManager();
    manager.addServer(serverId, {
      command: config.command,
      args: config.args,
      env: config.env,
    });

    logger.info(
      `MCP 服务器已安装: ${serverId}，来源: ${installedFrom}${sourceRegistry ? `(${sourceRegistry})` : ''}`
    );
  }

  /**
   * 卸载 MCP 服务器（删除配置 + 移除连接）
   */
  async uninstall(serverId: string): Promise<void> {
    const manager = getMCPServerManager();
    manager.removeServer(serverId);

    await this.configWriter.uninstall(serverId);
    this.store.removeServer(serverId);

    logger.info(`MCP 服务器已卸载: ${serverId}`);
  }

  /**
   * 获取已安装的服务器列表
   */
  getInstalledServers(): InstalledMCPServer[] {
    return this.store.getAllServers();
  }

  /**
   * 获取已安装服务器详情（含配置状态）
   */
  getInstalledServerDetail(name: string): {
    metadata: InstalledMCPServer | undefined;
    config: ScopedMcpServerConfig | undefined;
    connected: boolean;
  } {
    const metadata = this.store.getServer(name);
    const config = enhancedMcpConfigManager.getConfig(name);
    const serverInfos = getMCPServerManager().getServerInfos();
    const serverInfo = serverInfos.find((s) => s.name === name);

    return {
      metadata,
      config,
      connected:
        serverInfo?.status === MCPServerStatus.CONNECTED ||
        serverInfo?.status?.toString() === 'connected',
    };
  }

  /**
   * 判断服务器是否已安装
   */
  isInstalled(name: string): boolean {
    return this.store.isInstalled(name);
  }

  /**
   * 切换服务器启用/禁用
   */
  async toggleServer(name: string, enabled: boolean): Promise<void> {
    this.store.toggleServer(name, enabled);
    await this.configWriter.toggle(name, enabled);
  }

  /**
   * 切换工具启用/禁用
   */
  toggleTool(
    serverName: string,
    toolName: string,
    enabled: boolean
  ): void {
    this.store.toggleTool(serverName, toolName, enabled);
    logger.info(
      `MCP 工具 ${enabled ? '启用' : '禁用'}: ${serverName}/${toolName}`
    );
  }

  /**
   * 判断工具是否禁用
   */
  isToolDisabled(serverName: string, toolName: string): boolean {
    return this.store.isToolDisabled(serverName, toolName);
  }

  /**
   * 更新服务器配置信息
   */
  async updateConfig(
    name: string,
    updates: Partial<ServerInstallConfig>
  ): Promise<void> {
    const existing = this.store.getServer(name);

    if (!existing) {
      throw new Error(`服务器 "${name}" 未安装`);
    }

    const newConfig = { ...existing.config, ...updates };

    this.store.updateServer(name, {
      config: newConfig,
      updatedAt: Date.now(),
    });

    await this.configWriter.install(name, newConfig);

    logger.info(`MCP 服务器配置已更新: ${name}`);
  }

  /**
   * 获取分类列表
   */
  async getCategories(): Promise<
    Array<{ id: string; name: string; count: number }>
  > {
    return await this.registryHub.getCategories();
  }
}

export const mcpMarketplace = new MCPMarketplace();
