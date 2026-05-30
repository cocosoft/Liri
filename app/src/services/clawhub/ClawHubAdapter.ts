/**
 * ClawHubAdapter
 * ClawHub 生态对接适配器，作为第三方技能市场与 Liri 插件系统之间的桥梁。
 * 负责协调 LocalSkillStore、Installer、SearchEngine、SkillConverter 等模块的工作。
 */

import { EventEmitter } from 'events';
import { LocalSkillStore } from './LocalSkillStore';
import { SearchEngine } from './SearchEngine';
import { Installer } from './Installer';
import { SkillConverter } from './SkillConverter';
import { SkillAuditService } from './SkillAuditService';
import { PluginRegistry } from '@modules/plugins/core/PluginRegistry';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * ClawHub 适配器配置
 */
export interface ClawHubAdapterConfig {
  /** ClawHub API 基础地址 */
  apiBaseUrl?: string;
  /** 本地技能存储路径 */
  skillsPath?: string;
  /** 是否启用自动更新 */
  autoUpdate?: boolean;
  /** 更新检查间隔（毫秒），默认 24 小时 */
  updateInterval?: number;
}

/**
 * 技能元数据（ClawHub 标准格式）
 */
export interface ClawHubSkillMeta {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  /** 许可证类型 */
  license?: string;
  /** 技能类别 */
  category?: string;
  /** 标签 */
  tags?: string[];
  /** 图标 URL 或 base64 */
  icon?: string;
  /** 详细说明 */
  readme?: string;
  /** 依赖列表 */
  dependencies?: string[];
  /** ClawHub 权限声明 */
  permissions?: string[];
  /** 清单格式版本 */
  manifestVersion?: string;
  /** 来源标识 */
  source?: string;
}

/**
 * 已安装技能信息
 */
export interface InstalledSkill {
  meta: ClawHubSkillMeta;
  /** 安装路径 */
  installPath: string;
  /** 安装时间 */
  installedAt: number;
  /** 最后更新时间 */
  updatedAt: number;
  /** 是否启用 */
  enabled: boolean;
  /** 技能文件路径列表 */
  files: string[];
  /** 来源 URL */
  sourceUrl?: string;
}

/**
 * 技能搜索结果
 */
export interface SkillSearchResult {
  skill: ClawHubSkillMeta;
  /** 来源（clawhub / local） */
  source: string;
  /** 相关度分数 */
  score?: number;
  /** 是否已安装 */
  installed?: boolean;
}

/**
 * ClawHub 适配器
 * 作为单例使用，协调各子模块完成技能发现、安装、注册全流程。
 */
export class ClawHubAdapter extends EventEmitter {
  private static instance: ClawHubAdapter;

  private localStore: LocalSkillStore;
  private searchEngine: SearchEngine;
  private installer: Installer;
  private converter: SkillConverter;
  private auditService: SkillAuditService;
  private pluginRegistry: PluginRegistry | null = null;

  private config: ClawHubAdapterConfig;
  private initialized = false;
  private _updateTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * 构造函数
   * @param config 适配器配置
   * @param pluginRegistry 插件注册表（可选）
   */
  constructor(
    config: ClawHubAdapterConfig = {},
    pluginRegistry?: PluginRegistry
  ) {
    super();

    this.config = {
      apiBaseUrl: 'https://api.clawhub.com/v1',
      autoUpdate: false,
      updateInterval: 24 * 60 * 60 * 1000,
      ...config,
    };

    this.pluginRegistry = pluginRegistry || null;

    this.localStore = new LocalSkillStore({
      skillsPath: this.config.skillsPath,
    });
    this.searchEngine = new SearchEngine({
      apiBaseUrl: this.config.apiBaseUrl,
    });
    this.installer = new Installer({
      apiBaseUrl: this.config.apiBaseUrl,
      localStore: this.localStore,
    });
    this.converter = new SkillConverter();
    this.auditService = new SkillAuditService(this.localStore.getSkillsPath());
  }

  /**
   * 获取单例
   */
  static getInstance(
    config?: ClawHubAdapterConfig,
    pluginRegistry?: PluginRegistry
  ): ClawHubAdapter {
    if (!ClawHubAdapter.instance) {
      ClawHubAdapter.instance = new ClawHubAdapter(config, pluginRegistry);
    }
    return ClawHubAdapter.instance;
  }

  /**
   * 初始化适配器及其子模块
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      await this.localStore.initialize();
      logger.info('ClawHubAdapter 初始化完成');
      this.initialized = true;
      this.emit('initialized');

      if (this.config.autoUpdate) {
        this.startAutoUpdate();
      }
    } catch (error) {
      logger.error('ClawHubAdapter 初始化失败', error as Error);
      throw error;
    }
  }

  /**
   * 设置插件注册表引用
   * @param registry PluginRegistry 实例
   */
  setPluginRegistry(registry: PluginRegistry): void {
    this.pluginRegistry = registry;
  }

  /**
   * 搜索技能
   * 同时搜索远程 ClawHub 市场和本地已安装技能
   * @param query 搜索关键词
   * @param options 搜索选项（类别、标签等）
   * @returns 合并后的搜索结果
   */
  async searchSkills(
    query: string,
    options?: { category?: string; tags?: string[] }
  ): Promise<SkillSearchResult[]> {
    const [localResults, remoteResults] = await Promise.all([
      this.localStore.searchLocal(query, options),
      this.searchEngine.searchRemote(query, options),
    ]);

    const installedIds = new Set(localResults.map((r) => r.skill.id));

    const merged = [
      ...localResults.map((r) => ({ ...r, installed: true })),
      ...remoteResults
        .filter((r) => !installedIds.has(r.skill.id))
        .map((r) => ({ ...r, installed: false })),
    ];

    return merged;
  }

  /**
   * 获取已安装技能列表
   * @returns 已安装技能列表
   */
  async getInstalledSkills(): Promise<InstalledSkill[]> {
    return this.localStore.getAllSkills();
  }

  /**
   * 安装技能
   * @param skillId 技能 ID
   * @param sourceUrl 来源 URL（可选，默认从 ClawHub 市场拉取）
   * @returns 安装结果
   */
  async installSkill(
    skillId: string,
    sourceUrl?: string
  ): Promise<InstalledSkill> {
    const installed = await this.installer.install(skillId, sourceUrl);

    await this.localStore.addSkill(installed);

    this.tryRegisterWithPluginSystem(installed);

    this.emit('skill:installed', installed);
    logger.info(`技能已安装: ${installed.meta.name}@${installed.meta.version}`);

    this.auditService.recordInstall(
      installed.meta.id,
      installed.meta.name,
      installed.meta.version,
      true
    );

    return installed;
  }

  /**
   * 卸载技能
   * @param skillId 技能 ID
   */
  async uninstallSkill(skillId: string): Promise<void> {
    const skill = await this.localStore.getSkill(skillId);
    if (!skill) {
      throw new Error(`技能未安装: ${skillId}`);
    }

    await this.installer.uninstall(skill);
    await this.localStore.removeSkill(skillId);

    this.emit('skill:uninstalled', { id: skillId });
    logger.info(`技能已卸载: ${skillId}`);

    this.auditService.recordUninstall(skill.meta.id, skill.meta.name);
  }

  /**
   * 更新技能
   * @param skillId 技能 ID
   * @returns 更新后的技能信息
   */
  async updateSkill(skillId: string): Promise<InstalledSkill> {
    const current = await this.localStore.getSkill(skillId);
    if (!current) {
      throw new Error(`技能未安装: ${skillId}`);
    }

    const updated = await this.installer.update(skillId, current);
    await this.localStore.updateSkill(skillId, updated);

    this.emit('skill:updated', updated);
    logger.info(`技能已更新: ${updated.meta.name}@${updated.meta.version}`);

    this.auditService.recordUpdate(
      updated.meta.id,
      updated.meta.name,
      current.meta.version,
      updated.meta.version,
      true
    );

    return updated;
  }

  /**
   * 获取技能详情
   * @param skillId 技能 ID
   * @returns 技能详情或 null
   */
  async getSkillDetail(skillId: string): Promise<InstalledSkill | null> {
    return this.localStore.getSkill(skillId);
  }

  /**
   * 启用技能
   * @param skillId 技能 ID
   */
  async enableSkill(skillId: string): Promise<void> {
    const skill = await this.localStore.getSkill(skillId);
    await this.localStore.setEnabled(skillId, true);
    this.emit('skill:enabled', { id: skillId });

    if (skill) {
      this.auditService.recordToggle(skill.meta.id, skill.meta.name, true);
    }
  }

  /**
   * 禁用技能
   * @param skillId 技能 ID
   */
  async disableSkill(skillId: string): Promise<void> {
    const skill = await this.localStore.getSkill(skillId);
    await this.localStore.setEnabled(skillId, false);
    this.emit('skill:disabled', { id: skillId });

    if (skill) {
      this.auditService.recordToggle(skill.meta.id, skill.meta.name, false);
    }
  }

  /**
   * 检查所有已安装技能的更新
   * @returns 有可用更新的技能列表
   */
  async checkAllUpdates(): Promise<
    Array<{
      skillId: string;
      skillName: string;
      currentVersion: string;
      latestVersion: string;
    }>
  > {
    const allSkills = await this.localStore.getAllSkills();
    const results: Array<{
      skillId: string;
      skillName: string;
      currentVersion: string;
      latestVersion: string;
    }> = [];

    for (const skill of allSkills) {
      const updateInfo = await this.installer.checkUpdate(
        skill.meta.id,
        skill.meta.version
      );

      if (updateInfo && updateInfo.hasUpdate) {
        results.push({
          skillId: skill.meta.id,
          skillName: skill.meta.name,
          currentVersion: updateInfo.currentVersion,
          latestVersion: updateInfo.latestVersion,
        });
      }
    }

    if (results.length > 0) {
      logger.info(`发现 ${results.length} 个技能有可用更新`);
      this.emit('updates:available', results);
    }

    return results;
  }

  /**
   * 启动自动更新检查
   * 按配置的间隔定期检查已安装技能的更新
   */
  startAutoUpdate(): void {
    if (this._updateTimer) {
      return;
    }

    const interval = this.config.updateInterval || 24 * 60 * 60 * 1000;

    this._updateTimer = setInterval(async () => {
      try {
        await this.checkAllUpdates();
      } catch (error) {
        logger.warn('自动更新检查失败', error as Error);
      }
    }, interval);

    logger.info(`自动更新检查已启动，间隔: ${interval / 3600000} 小时`);
  }

  /**
   * 停止自动更新检查
   */
  stopAutoUpdate(): void {
    if (this._updateTimer) {
      clearInterval(this._updateTimer);
      this._updateTimer = null;
      logger.info('自动更新检查已停止');
    }
  }

  /**
   * 尝试将已安装技能注册到插件系统
   * 通过 FallbackPluginLoader 模式，让插件系统能识别 ClawHub 技能
   * @param installed 已安装的技能
   */
  private tryRegisterWithPluginSystem(installed: InstalledSkill): void {
    if (!this.pluginRegistry) {
      return;
    }

    try {
      const converted = this.converter.toPluginRegistration(installed);
      this.pluginRegistry.registerPlugin(converted);
      logger.debug(`技能已注册到插件系统: ${installed.meta.name}`);
    } catch (error) {
      logger.warn(
        `技能注册到插件系统失败: ${installed.meta.name}`,
        error as Error
      );
    }
  }

  /**
   * 创建回退加载器
   * 用于 PluginRegistry.setFallback()，使插件系统在查找插件时
   * 自动从 ClawHub 已安装技能中查找
   * @returns FallbackLoader 函数
   */
  createFallbackLoader(): (pluginName: string) => any {
    return (pluginName: string) => {
      const allSkills = this.localStore.getAllSkillsSync();
      const skill = allSkills.find(
        (s) => s.meta.name === pluginName || s.meta.id === pluginName
      );

      if (!skill) {
        return undefined;
      }

      return this.converter.toPluginRegistration(skill);
    };
  }

  /**
   * 获取本地技能存储
   */
  getLocalStore(): LocalSkillStore {
    return this.localStore;
  }

  /**
   * 获取搜索模块
   */
  getSearchEngine(): SearchEngine {
    return this.searchEngine;
  }

  /**
   * 获取安装器
   */
  getInstaller(): Installer {
    return this.installer;
  }

  /**
   * 获取格式转换器
   */
  getConverter(): SkillConverter {
    return this.converter;
  }

  /**
   * 获取适配器配置
   */
  getConfig(): ClawHubAdapterConfig {
    return { ...this.config };
  }
}
