/**
 * CLI配置管理模块
 * 支持配置文件解析、验证和管理
 *
 * @deprecated 请使用 @modules/config/ConfigManager 替代。
 *   自 2026-06 起 I/O 已打通至主配置系统的用户设置（userSettings），
 *   不再维护独立 config.json 文件。Gateway/alias 等配置统一存储在
 *   ~/.pyapp/settings.json 的 cli 键下。此文件将在未来版本中移除。
 */

import { z } from 'zod';
import { Logger, LogLevel } from '@modules/monitoring';
import {
  loadUserSettings,
  saveUserSettings,
  getUserSettingsPath,
} from '@modules/config/settings/userSettings';

const logger = new Logger({ module: 'cli:config', level: LogLevel.INFO });

export interface ConfigOptions {
  configDir?: string;
  configName?: string;
}

/**
 * 配置Schema
 */
const ConfigSchema = z.object({
  // 应用配置
  app: z
    .object({
      name: z.string().default('pyapp'),
      version: z.string().default('1.0.0'),
      debug: z.boolean().default(false),
      logLevel: z
        .enum(['trace', 'debug', 'info', 'warn', 'error'])
        .default('info'),
    })
    .default({}),

  // CLI配置
  cli: z
    .object({
      prompt: z.string().default('pyapp> '),
      historySize: z.number().int().positive().default(1000),
      autoUpdate: z.boolean().default(true),
      autoUpdateInterval: z.number().int().positive().default(24),
      color: z.boolean().default(true),
    })
    .default({}),

  // 编辑器配置
  editor: z
    .object({
      defaultEditor: z.string().default('vim'),
      lineNumbers: z.boolean().default(true),
      tabSize: z.number().int().positive().default(4),
      autoSave: z.boolean().default(false),
    })
    .default({}),

  // 别名配置
  aliases: z.record(z.string(), z.string()).default({}),

  // 插件配置
  plugins: z
    .object({
      enabled: z.array(z.string()).default([]),
      disabled: z.array(z.string()).default([]),
    })
    .default({}),

  // 代理配置
  agent: z
    .object({
      defaultAgent: z.string().default('default'),
      timeout: z.number().int().positive().default(30),
      maxRetries: z.number().int().nonnegative().default(3),
    })
    .default({}),

  // Gateway 通道配置
  gateway: z
    .object({
      enabled: z.boolean().default(true),
      telegram: z
        .object({
          enabled: z.boolean().default(false),
          token: z.string().default(''),
          pollingTimeout: z.number().int().positive().default(30),
          pollingInterval: z.number().int().positive().default(1000),
        })
        .default({}),
      websocket: z
        .object({
          enabled: z.boolean().default(true),
          host: z.string().default('0.0.0.0'),
          port: z.number().int().positive().default(8080),
          path: z.string().default('/'),
          maxMessageSize: z.number().int().positive().default(1048576),
        })
        .default({}),
    })
    .default({}),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * CLI 配置管理器
 *
 * @deprecated 请使用 @modules/config/ConfigManager 替代。
 *   自 2026-06 起 I/O 已打通至主配置系统的用户设置（userSettings），
 *   不再维护独立 config.json 文件。此文件将在未来版本中移除。
 */
export class CliConfigManager {
  private config: Config;

  constructor(_options?: ConfigOptions) {
    this.config = this.loadConfig();
  }

  /**
   * 从主配置系统用户设置加载 CLI 配置
   */
  private loadConfig(): Config {
    try {
      const settings = loadUserSettings();
      const cliConfig = settings.cli;
      if (cliConfig && typeof cliConfig === 'object') {
        return ConfigSchema.parse(cliConfig);
      }
    } catch (error) {
      logger.warning(`加载CLI配置失败: ${(error as Error).message}`);
    }

    return ConfigSchema.parse({});
  }

  /**
   * 保存配置到主配置系统用户设置
   */
  save(): void {
    try {
      const settings = loadUserSettings();
      settings.cli = this.config as unknown as Record<string, unknown>;
      saveUserSettings(settings);
    } catch (error) {
      logger.error(`保存CLI配置失败: ${(error as Error).message}`);
    }
  }

  /**
   * 获取完整配置
   */
  getConfig(): Config {
    return { ...this.config };
  }

  /**
   * 获取应用配置
   */
  getAppConfig(): Config['app'] {
    return { ...this.config.app };
  }

  /**
   * 获取CLI配置
   */
  getCliConfig(): Config['cli'] {
    return { ...this.config.cli };
  }

  /**
   * 获取编辑器配置
   */
  getEditorConfig(): Config['editor'] {
    return { ...this.config.editor };
  }

  /**
   * 获取 Gateway 通道配置
   */
  getGatewayConfig(): Config['gateway'] {
    return { ...this.config.gateway };
  }

  /**
   * 获取别名配置
   */
  getAliases(): Record<string, string> {
    return { ...this.config.aliases };
  }

  /**
   * 添加别名
   */
  addAlias(name: string, command: string): void {
    this.config.aliases[name] = command;
    this.save();
  }

  /**
   * 删除别名
   */
  removeAlias(name: string): boolean {
    if (this.config.aliases[name]) {
      delete this.config.aliases[name];
      this.save();
      return true;
    }
    return false;
  }

  /**
   * 获取别名对应的命令
   */
  getAlias(name: string): string | undefined {
    return this.config.aliases[name];
  }

  /**
   * 检查别名是否存在
   */
  hasAlias(name: string): boolean {
    return !!this.config.aliases[name];
  }

  /**
   * 设置配置值（支持路径式设置）
   */
  set(path: string, value: unknown): boolean {
    const parts = path.split('.');
    let current: unknown = this.config;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (typeof current === 'object' && current !== null && part in current) {
        current = (current as Record<string, unknown>)[part];
      } else {
        return false;
      }
    }

    const lastPart = parts[parts.length - 1];
    if (typeof current === 'object' && current !== null) {
      (current as Record<string, unknown>)[lastPart] = value;
      this.save();
      return true;
    }

    return false;
  }

  /**
   * 获取配置值（支持路径式获取）
   */
  get(path: string): unknown {
    const parts = path.split('.');
    let current: unknown = this.config;

    for (const part of parts) {
      if (typeof current === 'object' && current !== null && part in current) {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return current;
  }

  /**
   * 重置配置到默认值
   */
  reset(): void {
    this.config = ConfigSchema.parse({});
    this.save();
  }

  /**
   * 获取配置文件路径（指向主配置系统的用户设置文件）
   */
  getConfigPath(): string {
    return getUserSettingsPath();
  }

  /**
   * 验证配置
   */
  validate(): { valid: boolean; errors?: string[] } {
    const result = ConfigSchema.safeParse(this.config);
    if (result.success) {
      return { valid: true };
    }
    return {
      valid: false,
      errors: result.error.errors.map((e) => e.message),
    };
  }
}

/**
 * 创建 CLI 配置管理器实例
 *
 * @deprecated 请使用 @modules/config/ConfigManager 替代。
 */
export function createCliConfigManager(
  options?: ConfigOptions
): CliConfigManager {
  return new CliConfigManager(options);
}

/**
 * 全局 CLI 配置管理器实例
 *
 * @deprecated 请使用 @modules/config/ConfigManager 替代。
 */
export const cliConfigManager = createCliConfigManager();
