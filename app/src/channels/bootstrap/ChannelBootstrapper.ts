/**
 * ChannelBootstrapper — 通道自动注册启动器
 * 根据配置文件自动创建并注册已启用通道到 ChannelRegistry
 */
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { channelRegistry } from '../registry/ChannelRegistry';
import { EffectScope } from '@modules/context/EffectScope';
import type { IChannelPlugin } from '../types/IChannel';

const logger = getLogger('channels:bootstrap');

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
  /** T3.4: 通道级 EffectScope——注册的通道登记注销逆操作，disposeAll 统一回收 */
  private channelScopes: Map<string, EffectScope> = new Map();
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

        // T3.4: 通道级 scope——登记注销逆操作，disposeAll 时统一回收
        const scope = new EffectScope();
        this.channelScopes.set(entry.type, scope);
        scope.onDispose(() => {
          try {
            channelRegistry.unregister(plugin.id);
          } catch {
            // @ignore-catch — 注销失败仅日志，不阻断 scope 释放
          }
        });

        result.registered++;
        logger.info(
          `ChannelBootstrapper: 通道已注册 — ${plugin.id} (${entry.type})`
        );
      } catch (error) {
        const msg = `注册通道失败: ${entry.type} — ${error instanceof Error ? error.message : String(error)}`;
        handleError(error instanceof Error ? error : new Error(String(error)), {
          module: 'channels:bootstrap',
          action: msg,
        });
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

  /**
   * 释放全部通道级 scope（优雅退出时调用）。
   * 幂等：每个通道 scope 仅 dispose 一次；dispose 失败上报，不阻断其余通道。
   */
  async disposeAll(): Promise<void> {
    const scopes = Array.from(this.channelScopes.values());
    this.channelScopes.clear();
    for (const scope of scopes) {
      try {
        await scope.dispose();
      } catch (error) {
        await handleError(error, {
          module: 'channels:bootstrap',
          action: 'disposeAll 通道 scope',
        });
      }
    }
    this.pluginInstances.clear();
    this.initialized = false;
  }
}

/**
 * 全局 ChannelBootstrapper 实例
 */
export const channelBootstrapper = new ChannelBootstrapper();
