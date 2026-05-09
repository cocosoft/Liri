//
/**
 * 插件和技能生态系统
 * 提供插件注册、发现、管理和市场功能
 */

import { logger } from '../utils/log.js';
import { TerminalComponents, type TableColumn, type TableRow } from '../ui/TerminalComponents.js';
import chalk from 'chalk';

/**
 * 获取徽章文本（鉴于TerminalComponents没有getBadgeText方法，使用chalk直接创建）
 */
function getBadgeText(text: string, color: string): string {
  const colorMap: Record<string, chalk.Chalk> = {
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
 * 插件信息
 */
export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  tags: string[];
  category: string;
  rating?: number;
  downloads?: number;
  installed?: boolean;
  enabled?: boolean;
  path?: string;
  entryPoint?: string;
}

/**
 * 技能信息
 */
export interface SkillInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  tags: string[];
  category: string;
  pluginId?: string;
  rating?: number;
  usageCount?: number;
  installed?: boolean;
  enabled?: boolean;
  path?: string;
}

/**
 * 插件市场条目
 */
export interface MarketplaceEntry {
  plugin: PluginInfo;
  skills: SkillInfo[];
  lastUpdated: string;
  size: string;
  dependencies: string[];
}

/**
 * 生态系统配置
 */
export interface EcosystemConfig {
  marketplaceUrl?: string;
  localPluginPath?: string;
  localSkillPath?: string;
  autoUpdate?: boolean;
  allowThirdParty?: boolean;
}

/**
 * 插件和技能生态系统
 */
export class PluginEcosystem {
  private plugins: Map<string, PluginInfo> = new Map();
  private skills: Map<string, SkillInfo> = new Map();
  private marketplace: Map<string, MarketplaceEntry> = new Map();
  private config: EcosystemConfig;

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
   * 注册插件
   */
  registerPlugin(plugin: PluginInfo): void {
    if (this.plugins.has(plugin.id)) {
      logger.warn(`Plugin ${plugin.id} is already registered`);
      return;
    }

    this.plugins.set(plugin.id, {
      ...plugin,
      installed: true,
      enabled: true,
    });

    logger.info(`Registered plugin: ${plugin.name} v${plugin.version}`);
  }

  /**
   * 注册技能
   */
  registerSkill(skill: SkillInfo): void {
    if (this.skills.has(skill.id)) {
      logger.warn(`Skill ${skill.id} is already registered`);
      return;
    }

    this.skills.set(skill.id, {
      ...skill,
      installed: true,
      enabled: true,
    });

    logger.info(`Registered skill: ${skill.name} v${skill.version}`);
  }

  /**
   * 注销插件
   */
  unregisterPlugin(pluginId: string): boolean {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      return false;
    }

    // 注销关联的技能
    const associatedSkills = this.getPluginSkills(pluginId);
    for (const skill of associatedSkills) {
      this.unregisterSkill(skill.id);
    }

    this.plugins.delete(pluginId);
    logger.info(`Unregistered plugin: ${pluginId}`);
    return true;
  }

  /**
   * 注销技能
   */
  unregisterSkill(skillId: string): boolean {
    const skill = this.skills.get(skillId);
    if (!skill) {
      return false;
    }

    this.skills.delete(skillId);
    logger.info(`Unregistered skill: ${skillId}`);
    return true;
  }

  /**
   * 启用插件
   */
  enablePlugin(pluginId: string): boolean {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      return false;
    }

    plugin.enabled = true;
    logger.info(`Enabled plugin: ${pluginId}`);
    return true;
  }

  /**
   * 禁用插件
   */
  disablePlugin(pluginId: string): boolean {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      return false;
    }

    plugin.enabled = false;
    logger.info(`Disabled plugin: ${pluginId}`);
    return true;
  }

  /**
   * 启用技能
   */
  enableSkill(skillId: string): boolean {
    const skill = this.skills.get(skillId);
    if (!skill) {
      return false;
    }

    skill.enabled = true;
    logger.info(`Enabled skill: ${skillId}`);
    return true;
  }

  /**
   * 禁用技能
   */
  disableSkill(skillId: string): boolean {
    const skill = this.skills.get(skillId);
    if (!skill) {
      return false;
    }

    skill.enabled = false;
    logger.info(`Disabled skill: ${skillId}`);
    return true;
  }

  /**
   * 获取插件
   */
  getPlugin(pluginId: string): PluginInfo | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * 获取技能
   */
  getSkill(skillId: string): SkillInfo | undefined {
    return this.skills.get(skillId);
  }

  /**
   * 获取所有插件
   */
  getAllPlugins(): PluginInfo[] {
    return Array.from(this.plugins.values());
  }

  /**
   * 获取所有技能
   */
  getAllSkills(): SkillInfo[] {
    return Array.from(this.skills.values());
  }

  /**
   * 获取插件关联的技能
   */
  getPluginSkills(pluginId: string): SkillInfo[] {
    return Array.from(this.skills.values()).filter(
      skill => skill.pluginId === pluginId
    );
  }

  /**
   * 按类别搜索插件
   */
  searchPlugins(category?: string, tags?: string[]): PluginInfo[] {
    let results = this.getAllPlugins();

    if (category) {
      results = results.filter(p => p.category === category);
    }

    if (tags && tags.length > 0) {
      results = results.filter(p =>
        tags.some(tag => p.tags.includes(tag))
      );
    }

    return results;
  }

  /**
   * 按类别搜索技能
   */
  searchSkills(category?: string, tags?: string[]): SkillInfo[] {
    let results = this.getAllSkills();

    if (category) {
      results = results.filter(s => s.category === category);
    }

    if (tags && tags.length > 0) {
      results = results.filter(s =>
        tags.some(tag => s.tags.includes(tag))
      );
    }

    return results;
  }

  /**
   * 添加市场条目
   */
  addMarketplaceEntry(entry: MarketplaceEntry): void {
    this.marketplace.set(entry.plugin.id, entry);
  }

  /**
   * 从市场获取插件
   */
  getMarketplacePlugin(pluginId: string): MarketplaceEntry | undefined {
    return this.marketplace.get(pluginId);
  }

  /**
   * 获取所有市场条目
   */
  getAllMarketplaceEntries(): MarketplaceEntry[] {
    return Array.from(this.marketplace.values());
  }

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

    const rows = plugins.map(p => {
      const statusBadge = getBadgeText(
        p.enabled ? '启用' : '禁用',
        p.enabled ? 'green' : 'gray'
      );

      return [
        p.name,
        p.version,
        p.author,
        p.category,
        statusBadge,
      ];
    });

    TerminalComponents.printTable(
      ['名称', '版本', '作者', '类别', '状态'].map(h => ({ header: h, width: 12 })),
      rows.map(r => ({ cells: r }))
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

    const rows = skills.map(s => {
      const statusBadge = getBadgeText(
        s.enabled ? '启用' : '禁用',
        s.enabled ? 'green' : 'gray'
      );

      return [
        s.name,
        s.version,
        s.author,
        s.category,
        statusBadge,
      ];
    });

    TerminalComponents.printTable(
      ['名称', '版本', '作者', '类别', '状态'].map(h => ({ header: h, width: 12 })),
      rows.map(r => ({ cells: r }))
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

    const rows = entries.map(e => {
      const installed = this.plugins.has(e.plugin.id);
      const statusBadge = getBadgeText(
        installed ? '已安装' : '可安装',
        installed ? 'green' : 'blue'
      );

      return [
        e.plugin.name,
        e.plugin.version,
        e.plugin.author,
        e.plugin.category,
        `${e.skills.length}个技能`,
        statusBadge,
      ];
    });

    TerminalComponents.printTable(
      ['名称', '版本', '作者', '类别', '技能数', '状态'].map(h => ({ header: h, width: 10 })),
      rows.map(r => ({ cells: r }))
    );
  }

  /**
   * 显示插件详情
   */
  showPluginDetails(pluginId: string): void {
    const plugin = this.plugins.get(pluginId);
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
      TerminalComponents.printList(skills.map(s => s.name));
    }
  }

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

    logger.info(`Imported ${config.plugins.length} plugins and ${config.skills.length} skills`);
  }
}

/**
 * 创建插件生态系统
 */
export function createPluginEcosystem(config?: EcosystemConfig): PluginEcosystem {
  return new PluginEcosystem(config);
}
