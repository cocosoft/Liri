/**
 * ChannelBootstrapper — 通道自动注册启动器
 * 根据配置文件自动创建并注册已启用通道到 ChannelRegistry
 */
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { channelRegistry } from '../registry/ChannelRegistry';
import type { IChannelPlugin } from '../types/IChannel';

const logger = new Logger({ level: LogLevel.INFO, module: 'channels:bootstrap' });

/**
 * 通道启动配置项
 */
export interface ChannelBootstrapEntry {
  type: string;
  enabled: boolean;
  options?: Record<string, unknown>;
}

/**
 * 通道引导配置
 */
export interface ChannelBootstrapConfig {
  channels: ChannelBootstrapEntry[];
}

/**
 * 通道引导结果
 */
export interface ChannelBootstrapResult {
  registered: number;
  errors: string[];
}

/**
 * 通道自动注册启动器
 * ChannelRegistry.register() 已原生支持 IChannelPlugin，
 * 此处直接传递插件实例即可自动适配
 */
export class ChannelBootstrapper {
  private pluginChannels: Map<string, () => IChannelPlugin | undefined> =
    new Map();
  private pluginInstances: Map<string, IChannelPlugin> = new Map();
  private initialized = false;

  /**
   * 注册 IChannelPlugin 通道工厂
   */
  registerPluginChannel(
    type: string,
    factory: () => IChannelPlugin | undefined
  ): void {
    this.pluginChannels.set(type, factory);
  }

  /**
   * 获取已注册的通道工厂
   */
  getPluginFactory(
    type: string
  ): (() => IChannelPlugin | undefined) | undefined {
    return this.pluginChannels.get(type);
  }

  /**
   * 获取已注册的通道插件实例
   */
  getPluginInstance(type: string): IChannelPlugin | undefined {
    return this.pluginInstances.get(type);
  }

  /**
   * 获取所有已注册的通道插件实例
   */
  getAllPluginInstances(): IChannelPlugin[] {
    return Array.from(this.pluginInstances.values());
  }

  /**
   * 根据配置启动所有通道
   */
  async bootstrap(
    config: ChannelBootstrapConfig
  ): Promise<ChannelBootstrapResult> {
    const result: ChannelBootstrapResult = { registered: 0, errors: [] };

    for (const entry of config.channels) {
      if (!entry.enabled) continue;

      const factory = this.pluginChannels.get(entry.type);
      if (!factory) continue;

      const plugin = factory();
      if (!plugin) {
        logger.warning(`ChannelBootstrapper: 通道工厂返回空 — ${entry.type}`);
        continue;
      }

      try {
        channelRegistry.register(plugin);
        this.pluginInstances.set(entry.type, plugin);
        result.registered++;
        logger.info(
          `ChannelBootstrapper: 通道已注册 — ${plugin.id} (${entry.type})`
        );
      } catch (error) {
        const msg = `注册通道失败: ${entry.type} — ${error instanceof Error ? error.message : String(error)}`;
        logger.error(msg);
        result.errors.push(msg);
      }
    }

    this.initialized = true;
    return result;
  }

  /**
   * 是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

/**
 * 全局 ChannelBootstrapper 实例
 */
export const channelBootstrapper = new ChannelBootstrapper();
