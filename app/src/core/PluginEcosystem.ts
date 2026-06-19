/**
 * 插件和技能生态系统（薄代理层）
 *
 * @deprecated 由 pluginSystem 统一替代。保留用于 --use-legacy-module-system 回退路径。
 * 数据查询委托给 PluginSystem，本地仅保留 SDK 程序化注册的插件/技能。
 * PluginSystem 绑定前调用相关方法会抛出 AppError。
 */

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

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { Logger, LogLevel } from '@modules/monitoring';
import {
  TerminalComponents,
  type TableColumn,
  type TableRow,
} from '@modules/ui/TerminalComponents.js';
import chalk from 'chalk';

import type { PluginSystem } from '@modules/plugins/index.js';

import type {
  PluginInfo,
  SkillInfo,
  MarketplaceEntry,
  EcosystemConfig,
} from '@modules/plugins/types/index.js';

const logger = new Logger({ level: LogLevel.INFO });

export type { PluginInfo, SkillInfo, MarketplaceEntry, EcosystemConfig };

/** 插件系统未绑定的错误消息 */
const ERR_NOT_BOUND =
  'PluginSystem 未绑定，请在初始化 PluginSystem 后调用 bindPluginSystem()';

/**
 * 获取徽章文本
 */
function getBadgeText(text: string, color: string): string {
  const colorMap: Record<string, typeof chalk> = {
    green: chalk.green,
    gray: chalk.gray,
    blue: chalk.blue,
    red: chalk.red,
    yellow: chalk.yellow,
  };
  const styler = colorMap[color] || chalk.white;
  return styler(` ${text} `);
}

/**
 * 插件和技能生态系统（薄代理层）
 *
 * 职责：
 * 1. 展示层 UI 方法（showPluginList 等）
 * 2. PluginSystem 查询的代理
 * 3. SDK 程序化注册插件的临时存储
 */
export class PluginEcosystem {
  /** SDK 注册的插件（PluginSystem 不支持程序化注册） */
  private sdkPlugins = new Map<string, PluginInfo>();
  /** SDK 注册的技能 */
  private sdkSkills = new Map<string, SkillInfo>();
  /** 市场条目 */
  private marketplace = new Map<string, MarketplaceEntry>();
  /** 生态系统配置 */
  private config: EcosystemConfig;
  /** PluginSystem 实例（绑定后可用） */
  private pluginSystem: PluginSystem | null = null;

  constructor(config?: EcosystemConfig) {
    this.config = {
      localPluginPath: './plugins',
      localSkillPath: './skills',
      autoUpdate: false,
      allowThirdParty: true,
      ...config,
    };
  }

  /**
   * 绑定 PluginSystem 实例
   * 必须在所有查询操作之前调用
   */
  bindPluginSystem(system: PluginSystem): void {
    this.pluginSystem = system;
  }

  /** 检查 PluginSystem 是否已绑定 */
  private ensureBound(): PluginSystem {
    if (!this.pluginSystem) {
      throw new AppError(
        ERR_NOT_BOUND,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH
      );
    }
    return this.pluginSystem;
  }

  // ==================== PluginSystem 代理查询 ====================

  /**
   * 获取插件
   * 优先查 PluginSystem，fallback 到 SDK 注册
   */
  getPlugin(pluginId: string): PluginInfo | undefined {
    if (this.pluginSystem) {
      const ps = this.pluginSystem
        .getPluginInfoList()
        .find((p) => p.id === pluginId);
      if (ps) return ps;
    }
    return this.sdkPlugins.get(pluginId);
  }

  /**
   * 获取所有插件
   * 合并 PluginSystem 和 SDK 注册的插件
   */
  getAllPlugins(): PluginInfo[] {
    const psPlugins = this.pluginSystem
      ? this.pluginSystem.getPluginInfoList()
      : [];
    return [...psPlugins, ...this.sdkPlugins.values()];
  }

  /**
   * 搜索插件
   */
  searchPlugins(category?: string, tags?: string[]): PluginInfo[] {
    const results = this.pluginSystem
      ? this.pluginSystem.searchPlugins(undefined, category, tags)
      : [];

    let sdkResults = Array.from(this.sdkPlugins.values());
    if (category) {
      sdkResults = sdkResults.filter((p) => p.category === category);
    }
    if (tags?.length) {
      sdkResults = sdkResults.filter((p) =>
        tags.some((tag) => p.tags.includes(tag))
      );
    }

    return [...results, ...sdkResults];
  }

  // ==================== SDK 注册/注销 ====================

  /**
   * 注册插件（SDK 路径）
   */
  registerPlugin(plugin: PluginInfo): void {
    if (this.sdkPlugins.has(plugin.id)) {
      logger.warn(`Plugin ${plugin.id} is already registered`);
      return;
    }
    this.sdkPlugins.set(plugin.id, {
      ...plugin,
      installed: true,
      enabled: true,
    });
  }

  /**
   * 注册技能（SDK 路径）
   */
  registerSkill(skill: SkillInfo): void {
    if (this.sdkSkills.has(skill.id)) {
      logger.warn(`Skill ${skill.id} is already registered`);
      return;
    }
    this.sdkSkills.set(skill.id, { ...skill, installed: true, enabled: true });
  }

  /**
   * 注销插件
   */
  unregisterPlugin(pluginId: string): boolean {
    const deleted = this.sdkPlugins.delete(pluginId);
    // 同时删除关联技能
    for (const [id, skill] of this.sdkSkills) {
      if (skill.pluginId === pluginId) this.sdkSkills.delete(id);
    }
    if (deleted) logger.info(`Unregistered SDK plugin: ${pluginId}`);
    return deleted;
  }

  /**
   * 注销技能
   */
  unregisterSkill(skillId: string): boolean {
    const deleted = this.sdkSkills.delete(skillId);
    if (deleted) logger.info(`Unregistered skill: ${skillId}`);
    return deleted;
  }

  /**
   * 启用插件
   */
  enablePlugin(pluginId: string): boolean {
    const plugin = this.sdkPlugins.get(pluginId);
    if (!plugin) return false;
    plugin.enabled = true;
    return true;
  }

  /**
   * 禁用插件
   */
  disablePlugin(pluginId: string): boolean {
    const plugin = this.sdkPlugins.get(pluginId);
    if (!plugin) return false;
    plugin.enabled = false;
    return true;
  }

  /**
   * 启用技能
   */
  enableSkill(skillId: string): boolean {
    const skill = this.sdkSkills.get(skillId);
    if (!skill) return false;
    skill.enabled = true;
    return true;
  }

  /**
   * 禁用技能
   */
  disableSkill(skillId: string): boolean {
    const skill = this.sdkSkills.get(skillId);
    if (!skill) return false;
    skill.enabled = false;
    return true;
  }

  // ==================== SDK 技能查询 ====================

  /**
   * 获取 SDK 技能
   */
  getSkill(skillId: string): SkillInfo | undefined {
    return this.sdkSkills.get(skillId);
  }

  /**
   * 获取所有 SDK 技能
   */
  getAllSkills(): SkillInfo[] {
    return Array.from(this.sdkSkills.values());
  }

  /**
   * 获取插件关联的技能
   */
  getPluginSkills(pluginId: string): SkillInfo[] {
    return Array.from(this.sdkSkills.values()).filter(
      (skill) => skill.pluginId === pluginId
    );
  }

  /**
   * 搜索 SDK 技能
   */
  searchSkills(category?: string, tags?: string[]): SkillInfo[] {
    let results = this.getAllSkills();
    if (category) {
      results = results.filter((s) => s.category === category);
    }
    if (tags?.length) {
      results = results.filter((s) => tags.some((tag) => s.tags.includes(tag)));
    }
    return results;
  }

  // ==================== 市场 ====================

  addMarketplaceEntry(entry: MarketplaceEntry): void {
    this.marketplace.set(entry.plugin.id, entry);
  }

  getMarketplacePlugin(pluginId: string): MarketplaceEntry | undefined {
    return this.marketplace.get(pluginId);
  }

  getAllMarketplaceEntries(): MarketplaceEntry[] {
    return Array.from(this.marketplace.values());
  }

  // ==================== 展示方法 ====================

  /**
   * 显示插件列表
   */
  showPluginList(): void {
    const plugins = this.getAllPlugins();
    if (plugins.length === 0) {
      TerminalComponents.printInfo('暂无已安装的插件');
      return;
    }

    TerminalComponents.printHeader('已安装插件');
    TerminalComponents.printTable(
      ['名称', '版本', '作者', '类别', '状态'].map(
        (h) => ({ header: h, width: 12 }) as TableColumn
      ),
      plugins.map((p) => ({
        cells: [
          p.name,
          p.version,
          p.author,
          p.category,
          getBadgeText(
            p.enabled ? '启用' : '禁用',
            p.enabled ? 'green' : 'gray'
          ),
        ],
      })) as TableRow[]
    );
  }

  /**
   * 显示技能列表
   */
  showSkillList(): void {
    const skills = this.getAllSkills();
    if (skills.length === 0) {
      TerminalComponents.printInfo('暂无已安装的技能');
      return;
    }

    TerminalComponents.printHeader('已安装技能');
    TerminalComponents.printTable(
      ['名称', '版本', '作者', '类别', '状态'].map(
        (h) => ({ header: h, width: 12 }) as TableColumn
      ),
      skills.map((s) => ({
        cells: [
          s.name,
          s.version,
          s.author,
          s.category,
          getBadgeText(
            s.enabled ? '启用' : '禁用',
            s.enabled ? 'green' : 'gray'
          ),
        ],
      })) as TableRow[]
    );
  }

  /**
   * 显示市场列表
   */
  showMarketplace(): void {
    const entries = this.getAllMarketplaceEntries();
    if (entries.length === 0) {
      TerminalComponents.printInfo('市场暂无可用插件');
      return;
    }

    TerminalComponents.printHeader('插件市场');
    TerminalComponents.printTable(
      ['名称', '版本', '作者', '类别', '技能数', '状态'].map(
        (h) => ({ header: h, width: 10 }) as TableColumn
      ),
      entries.map((e) => ({
        cells: [
          e.plugin.name,
          e.plugin.version,
          e.plugin.author,
          e.plugin.category,
          `${e.skills.length}个技能`,
          getBadgeText(
            this.sdkPlugins.has(e.plugin.id) ? '已安装' : '可安装',
            this.sdkPlugins.has(e.plugin.id) ? 'green' : 'blue'
          ),
        ],
      })) as TableRow[]
    );
  }

  /**
   * 显示插件详情
   */
  showPluginDetails(pluginId: string): void {
    const plugin = this.getPlugin(pluginId);
    if (!plugin) {
      TerminalComponents.printError(`未找到插件: ${pluginId}`);
      return;
    }

    TerminalComponents.printHeader(`插件详情 - ${plugin.name}`);
    TerminalComponents.printKeyValue([
      ['ID', plugin.id],
      ['名称', plugin.name],
      ['版本', plugin.version],
      ['作者', plugin.author],
      ['描述', plugin.description],
      ['类别', plugin.category],
      ['标签', plugin.tags.join(', ')],
      ['状态', plugin.enabled ? '启用' : '禁用'],
    ]);

    const skills = this.getPluginSkills(pluginId);
    if (skills.length > 0) {
      TerminalComponents.printInfo(`包含 ${skills.length} 个技能:`);
      TerminalComponents.printList(skills.map((s) => s.name));
    }
  }

  // ==================== 配置导入/导出 ====================

  /**
   * 导出插件配置
   */
  exportConfig(): { plugins: PluginInfo[]; skills: SkillInfo[] } {
    return {
      plugins: this.getAllPlugins(),
      skills: this.getAllSkills(),
    };
  }

  /**
   * 导入插件配置
   */
  importConfig(config: { plugins: PluginInfo[]; skills: SkillInfo[] }): void {
    for (const plugin of config.plugins) {
      this.registerPlugin(plugin);
    }
    for (const skill of config.skills) {
      this.registerSkill(skill);
    }
    logger.info(
      `Imported ${config.plugins.length} plugins and ${config.skills.length} skills`
    );
  }
}

/**
 * 创建插件生态系统实例
 */
export function createPluginEcosystem(
  config?: EcosystemConfig
): PluginEcosystem {
  return new PluginEcosystem(config);
}
