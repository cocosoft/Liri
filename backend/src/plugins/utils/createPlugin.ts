/**
 * 简化插件创建工具
 * 提供 createPlugin 函数，减少插件开发的样板代码
 */

import type { Plugin, PluginContext, PluginMetadata } from '../types/Plugin';
import { PluginStatus } from '../types/Plugin';

/**
 * 插件定义选项
 */
export interface PluginDefinition {
  metadata: PluginMetadata;
  initialize?: (context: PluginContext) => Promise<void>;
  start?: () => Promise<void>;
  stop?: () => Promise<void>;
  unload?: () => Promise<void>;
}

/**
 * 创建一个简化插件
 * @param definition 插件定义
 * @returns 插件实例
 */
export function createPlugin(definition: PluginDefinition): Plugin {
  const { metadata, initialize, start, stop, unload } = definition;

  return {
    metadata,
    status: PluginStatus.REGISTERED,

    async initialize(context: PluginContext): Promise<void> {
      this.status = PluginStatus.LOADED;
      if (initialize) {
        await initialize.call(this, context);
      }
    },

    async start(): Promise<void> {
      this.status = PluginStatus.ENABLED;
      if (start) {
        await start.call(this);
      }
    },

    async stop(): Promise<void> {
      this.status = PluginStatus.DISABLED;
      if (stop) {
        await stop.call(this);
      }
    },

    async unload(): Promise<void> {
      this.status = PluginStatus.REGISTERED;
      if (unload) {
        await unload.call(this);
      }
    },
  };
}
