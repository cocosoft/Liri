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
 * ClawHubAdapter
 * ClawHub 技能市场适配器，继承 BaseThirdPartyAdapter 模板。
 *
 * 实现 ThirdPartySkillAdapter 接口，通过实现 5 个抽象方法对接 ClawHub 市场，
 * 其余通用逻辑（安装/卸载/审计/Registry 同步）由基类提供。
 *
 * 可插拔：通过 ThirdPartyAdapterRegistry 注册，无需在 init.ts 中硬编码。
 */

import { Skill, SkillSource, SkillLoadMethod } from '@modules/skills/types';
import { BaseThirdPartyAdapter } from '../BaseThirdPartyAdapter';
import { LocalSkillStore } from '../LocalSkillStore';
import type { ThirdPartySkillSearchResult } from '../ThirdPartySkillAdapter';
import type { InstalledClawHubSkill } from './ClawHubMeta';
import { ClawHubConverter } from './ClawHubConverter';
import { ClawHubAPIClient } from './ClawHubAPIClient';
import { ClawHubInstaller } from './ClawHubInstaller';
import { Logger, LogLevel } from '@modules/monitoring';
import type { PluginRegistry } from '@modules/plugins/core/PluginRegistry';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * ClawHubAdapter 配置
 */
export interface ClawHubAdapterConfig {
  /** 技能存储路径 */
  skillsPath?: string;
  /** ClawHub API 基础地址 */
  apiBaseUrl?: string;
  /** 请求超时（毫秒） */
  timeout?: number;
}

/**
 * ClawHubAdapter
 * 单例模式，继承 BaseThirdPartyAdapter。
 */
export class ClawHubAdapter extends BaseThirdPartyAdapter<InstalledClawHubSkill> {
  readonly name = 'clawhub';
  readonly displayName = 'ClawHub 市场';

  private converter: ClawHubConverter;
  private apiClient: ClawHubAPIClient;
  private installer: ClawHubInstaller;

  /** PluginRegistry 引用（供插件系统回退加载器使用） */
  private pluginRegistry: PluginRegistry | null = null;

  private static instance: ClawHubAdapter | null = null;

  /**
   * 获取单例实例
   */
  static getInstance(config?: ClawHubAdapterConfig): ClawHubAdapter {
    if (!ClawHubAdapter.instance) {
      ClawHubAdapter.instance = new ClawHubAdapter(config);
    }
    return ClawHubAdapter.instance;
  }

  /**
   * 构造函数（私有，单例模式）
   */
  private constructor(config: ClawHubAdapterConfig = {}) {
    super({ skillsPath: config.skillsPath });

    this.converter = new ClawHubConverter();
    this.apiClient = new ClawHubAPIClient({
      apiBaseUrl: config.apiBaseUrl,
      timeout: config.timeout,
    });
    this.installer = new ClawHubInstaller({
      apiClient: this.apiClient,
      localStore: this.localStore as LocalSkillStore<InstalledClawHubSkill>,
    });
  }

  // ============================================================
  // 抽象方法实现
  // ============================================================

  /**
   * 将 InstalledClawHubSkill 转换为统一 Skill 类型
   */
  protected toSkill(internal: InstalledClawHubSkill): Skill {
    return {
      name: internal.meta.name,
      description: internal.meta.description,
      source: SkillSource.THIRD_PARTY,
      loadMethod: SkillLoadMethod.ADAPTER,
      loadedFrom: `clawhub:${internal.meta.id}`,
      version: internal.meta.version,
      author: internal.meta.author,
      aliases: [internal.meta.id],
      dependencies: internal.meta.dependencies,
      impl: {
        kind: 'executable',
        execute: async () => {
          return `[ClawHub] 执行技能: ${internal.meta.name} (路径: ${internal.installPath})`;
        },
      },
    };
  }

  /**
   * 将 InstalledClawHubSkill 转换为搜索结果
   */
  protected toSearchResult(
    internal: InstalledClawHubSkill
  ): ThirdPartySkillSearchResult {
    return {
      id: internal.meta.id,
      name: internal.meta.name,
      version: internal.meta.version,
      description: internal.meta.description,
      author: internal.meta.author,
      license: internal.meta.license,
      category: internal.meta.category,
      tags: internal.meta.tags,
      installed: internal.enabled,
    };
  }

  /**
   * 执行安装（下载 + 解压 + 加载）
   */
  protected async doInstall(
    skillId: string,
    sourceUrl?: string
  ): Promise<InstalledClawHubSkill> {
    return this.installer.install(skillId, sourceUrl);
  }

  /**
   * 执行卸载（删除文件）
   */
  protected async doUninstall(skill: InstalledClawHubSkill): Promise<void> {
    await this.installer.uninstall(skill);
  }

  /**
   * 远程搜索（在 ClawHub 市场中查询）
   */
  protected async doSearchRemote(
    query: string
  ): Promise<ThirdPartySkillSearchResult[]> {
    return this.apiClient.search(query);
  }

  // ============================================================
  // ClawHub 特有方法
  // ============================================================

  /**
   * 获取 ClawHub 技能详情（从远程 API）
   */
  async getRemoteSkillDetail(
    skillId: string
  ): Promise<ThirdPartySkillSearchResult | null> {
    const meta = await this.apiClient.getSkillDetail(skillId);
    if (!meta) return null;

    return {
      id: meta.id,
      name: meta.name,
      version: meta.version,
      description: meta.description,
      author: meta.author,
      license: meta.license,
      category: meta.category,
      tags: meta.tags,
      installed: false,
    };
  }

  /**
   * 获取 API 客户端
   */
  getAPIClient(): ClawHubAPIClient {
    return this.apiClient;
  }

  /**
   * 获取转换器
   */
  getConverter(): ClawHubConverter {
    return this.converter;
  }

  /**
   * 设置 PluginRegistry 引用（供插件系统回退加载器使用）
   * @param registry PluginRegistry 实例
   */
  setPluginRegistry(registry: PluginRegistry): void {
    this.pluginRegistry = registry;
  }

  /**
   * 创建回退加载器（供插件系统链式回退使用）
   * 返回一个函数，当内置插件找不到时，从 ClawHub 已安装技能中查找
   */
  createFallbackLoader(): (pluginName: string) => any {
    return (pluginName: string) => {
      const installed = this.localStore.getAllSkillsSync();
      const match = installed.find(
        (s) => s.meta.name === pluginName || s.meta.id === pluginName
      );
      if (!match) return null;

      return {
        id: pluginName,
        name: match.meta.name,
        version: match.meta.version,
        path: match.installPath,
        state: 'LOADED',
        registeredAt: new Date(),
        enabled: match.enabled,
        dependencies: [],
        dependents: [],
      };
    };
  }
}
