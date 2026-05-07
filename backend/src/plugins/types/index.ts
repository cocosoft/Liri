/**
 * 插件类型导出
 */

import * as PluginTypes from './Plugin.js';
import * as PluginMetadataTypes from './PluginMetadata.js';

// 导出Plugin.ts中的类型
export const PluginStatus = PluginTypes.PluginStatus;
export type {
  PluginDependency,
  PluginContext,
  Plugin,
  PluginManifest,
  PluginMetadata,
} from './Plugin.js';

// 导出PluginMetadata.ts中的类型
export type {
  CommandContribution,
  ToolContribution,
  MenuItem,
  MenuContribution,
  SettingContribution,
  PluginMetadata as PluginMetadataExtended,
} from './PluginMetadata.js';

export interface PluginConfig {
  repositories: Record<string, string>;
  enabled: string[];
  disabled: string[];
}

export interface PluginRepository {
  name: string;
  url: string;
  type: 'git' | 'npm' | 'local';
}

export interface LoadedPlugin {
  /**
   * 插件名称
   */
  name: string;
  /**
   * 插件清单
   */
  manifest: any;
  /**
   * 插件路径
   */
  path: string;
  /**
   * 插件来源
   */
  source: string;
  /**
   * 插件仓库
   */
  repository: string;
  /**
   * 是否启用
   */
  enabled: boolean;
  /**
   * Git提交SHA
   */
  sha?: string;
  /**
   * 命令路径
   */
  commandsPaths?: string[];
  /**
   * 代理路径
   */
  agentsPaths?: string[];
  /**
   * 技能路径
   */
  skillsPaths?: string[];
  /**
   * 钩子配置
   */
  hooksConfig?: any;
}

/**
 * 插件加载结果
 */
export interface PluginLoadResult {
  /**
   * 已启用的插件
   */
  enabled: LoadedPlugin[];
  /**
   * 已禁用的插件
   */
  disabled: LoadedPlugin[];
  /**
   * 错误列表
   */
  errors: PluginError[];
}

/**
 * 插件来源
 */
export type PluginSource =
  | string
  | {
      /**
       * 来源类型
       */
      type: 'git' | 'local' | 'npm' | 'github' | 'url' | 'git-subdir';
      /**
       * 来源地址
       */
      source: string;
      /**
       * 版本
       */
      version?: string;
      /**
       * Git提交SHA
       */
      sha?: string;
      /**
       * Git URL
       */
      url?: string;
      /**
       * Git引用
       */
      ref?: string;
      /**
       * 子目录路径
       */
      path?: string;
      /**
       * 包名
       */
      package?: string;
      /**
       * 仓库
       */
      repo?: string;
      /**
       * 注册表
       */
      registry?: string;
    };

/**
 * 插件错误
 */
export interface PluginError {
  /**
   * 错误类型
   */
  type: string;
  /**
   * 错误来源
   */
  source: string;
  /**
   * 插件名称
   */
  plugin: string;
  /**
   * 错误信息
   */
  error: string;
}
