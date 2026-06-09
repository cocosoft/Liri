// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * ConfigManager — 配置管理器
 *
 * 提供内存配置实现及多配置管理器，支持注册/获取/持久化。
 *
 * @deprecated 请使用 @modules/config/ConfigManager 替代。
 *   core/extensibility 中的 ConfigManager 为遗留实现，
 *   与 config/ConfigManager 功能重叠。
 *   此模块将在未来版本中移除。
 */

import { Config, ConfigValue } from './types.js';

/**
 * 内存配置
 */
export class MemoryConfig implements Config {
  private config: Record<string, ConfigValue> = {};

  get<T extends ConfigValue>(key: string, defaultValue?: T): T {
    const value = this.config[key];
    return (value !== undefined ? value : defaultValue) as T;
  }

  set(key: string, value: ConfigValue): void {
    this.config[key] = value;
  }

  has(key: string): boolean {
    return key in this.config;
  }

  delete(key: string): boolean {
    return delete this.config[key];
  }

  clear(): void {
    this.config = {};
  }

  toObject(): Record<string, ConfigValue> {
    return { ...this.config };
  }

  fromObject(config: Record<string, ConfigValue>): void {
    this.config = { ...config };
  }

  async load(): Promise<void> {
    // 实际实现中应该从文件或其他存储加载
  }

  async save(): Promise<void> {
    // 实际实现中应该保存到文件或其他存储
  }
}

/**
 * 配置管理器
 *
 * @deprecated 请使用 @modules/config/ConfigManager 替代（全局配置 + 多源合并）。
 * 此文件为扩展性框架的简化版 ConfigManager，与主配置系统功能重叠。
 * 此文件将在未来版本中移除。
 */
export class ConfigManager {
  private configs: Map<string, Config> = new Map();
  private defaultConfig: Config;

  constructor(defaultConfig: Config = new MemoryConfig()) {
    this.defaultConfig = defaultConfig;
  }

  /**
   * 获取配置
   */
  getConfig(name: string): Config {
    if (!this.configs.has(name)) {
      this.configs.set(name, new MemoryConfig());
    }
    return this.configs.get(name)!;
  }

  /**
   * 获取默认配置
   */
  getDefaultConfig(): Config {
    return this.defaultConfig;
  }

  /**
   * 注册配置
   */
  registerConfig(name: string, config: Config): void {
    this.configs.set(name, config);
  }

  /**
   * 移除配置
   */
  removeConfig(name: string): boolean {
    return this.configs.delete(name);
  }

  /**
   * 列出所有配置
   */
  listConfigs(): string[] {
    return Array.from(this.configs.keys());
  }

  /**
   * 加载所有配置
   */
  async loadAllConfigs(): Promise<void> {
    await this.defaultConfig.load();
    for (const config of this.configs.values()) {
      await config.load();
    }
  }

  /**
   * 保存所有配置
   */
  async saveAllConfigs(): Promise<void> {
    await this.defaultConfig.save();
    for (const config of this.configs.values()) {
      await config.save();
    }
  }

  /**
   * 销毁配置管理器
   */
  async destroy(): Promise<void> {
    await this.saveAllConfigs();
    this.configs.clear();
  }
}

/**
 * 创建默认的配置管理器
 */
export function createConfigManager(defaultConfig?: Config): ConfigManager {
  return new ConfigManager(defaultConfig || new MemoryConfig());
}
