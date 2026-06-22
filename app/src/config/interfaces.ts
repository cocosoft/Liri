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
 * 配置管理器统一接口
 *
 * 定义配置管理的标准访问协议，ConfigManager 和 UnifiedConfigManager 均应实现此接口。
 * 新代码应优先使用此接口类型，而非直接依赖具体实现类。
 *
 * @see ConfigManager 主要实现
 * @see UnifiedConfigManager @deprecated 兼容层
 */
export interface IConfigManager {
  // ========== 全局配置 ==========

  /**
   * 启用配置系统
   */
  enableConfigs(): void;

  /**
   * 获取全局配置对象
   */
  getGlobalConfig(): Record<string, unknown>;

  /**
   * 获取配置值（按 key 访问）
   */
  getConfigValue<T = unknown>(key: string): T | undefined;

  /**
   * 设置配置值
   */
  setConfigValue<T = unknown>(key: string, value: T): void;

  /**
   * 重置配置为默认值
   */
  resetConfig(): void;

  // ========== 环境变量 ==========

  /**
   * 获取环境变量值
   * @deprecated 优先使用 getConfig() 访问配置对象中的值
   */
  env(name: string, defaultValue?: string): string | undefined;

  // ========== 多源配置 ==========

  /**
   * 获取指定源的配置
   */
  getSourceConfig(source: string): Record<string, unknown> | undefined;

  /**
   * 设置指定源的配置
   */
  setSourceConfig(source: string, config: Record<string, unknown>): void;

  /**
   * 加载所有同步设置源
   */
  loadSyncSources(): void;

  /**
   * 刷新同步设置源
   */
  refreshSyncSources(): void;

  /**
   * 获取合并后的多源配置
   */
  getMergedConfig(): Record<string, unknown>;

  /**
   * 获取设置值及其来源
   */
  getSettingWithSource(
    key: string
  ): { value: unknown; source: string } | undefined;

  // ========== 点号记法访问 ==========

  /**
   * 通过点号路径获取配置值
   * @example getValue('models.current')
   */
  getValue<T = unknown>(key: string, defaultValue?: T): T;

  /**
   * 通过点号路径设置配置值
   * @example setValue('notifications.preferredChannel', 'native')
   */
  setValue(key: string, value: unknown, source?: string): void;

  // ========== 缓存与生命周期 ==========

  /**
   * 清除配置缓存
   */
  clearCache(): void;

  /**
   * 重新加载配置
   */
  reloadConfig(): Record<string, unknown>;

  /**
   * 销毁配置管理器
   */
  destroy(): void;
}
