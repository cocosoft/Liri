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
 * BaseThirdPartyAdapter
 * 第三方技能适配器抽象基类
 *
 * 提供通用模板方法（安装/卸载/搜索/审计/Registry 同步），
 * 子类只需实现 5 个抽象方法即可接入新的第三方技能市场。
 *
 * 可插拔设计：新适配器（Hermes、GitHub 等）只需：
 *   1. 继承 BaseThirdPartyAdapter
 *   2. 实现 5 个抽象方法
 *   3. 注册到 ThirdPartyAdapterRegistry
 */

import { EventEmitter } from 'events';
import { Logger, LogLevel } from '@modules/monitoring';
import { SkillSource, SkillLoadMethod } from '@modules/skills/types';
import type { Skill } from '@modules/skills/types';
import type { SkillRegistry } from '@modules/skills/SkillRegistry';
import { LocalSkillStore } from './LocalSkillStore';
import { SkillAuditService } from './SkillAuditService';
import type {
  ThirdPartySkillAdapter,
  ThirdPartySkillSearchResult,
} from './ThirdPartySkillAdapter';
import type { InstalledThirdPartySkill } from './types';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 第三方技能适配器抽象基类
 *
 * 泛型参数 T：适配器内部技能格式（需满足 InstalledThirdPartySkill 约束）
 */
export abstract class BaseThirdPartyAdapter<
  T extends InstalledThirdPartySkill = InstalledThirdPartySkill,
>
  extends EventEmitter
  implements ThirdPartySkillAdapter
{
  /** 适配器唯一标识 */
  abstract readonly name: string;

  /** 适配器显示名称 */
  abstract readonly displayName: string;

  /** 本地技能存储 */
  protected localStore: LocalSkillStore<T>;

  /** 审计服务 */
  protected auditService: SkillAuditService;

  /** SkillRegistry 引用（安装/卸载时同步通知） */
  protected skillRegistry: SkillRegistry | null = null;

  /** 是否已初始化 */
  protected initialized = false;

  /**
   * 构造函数
   * @param config 适配器配置
   */
  constructor(config: { skillsPath?: string }) {
    super();
    this.localStore = new LocalSkillStore<T>({
      skillsPath: config.skillsPath,
    });
    this.auditService = new SkillAuditService(this.localStore.getSkillsPath());
  }

  // ============================================================
  // 抽象方法 — 子类必须实现
  // ============================================================

  /**
   * 将内部技能格式转换为统一 Skill 类型
   * @param internal 内部技能格式
   */
  protected abstract toSkill(internal: T): Skill;

  /**
   * 将内部技能格式转换为搜索结果
   * @param internal 内部技能格式
   */
  protected abstract toSearchResult(internal: T): ThirdPartySkillSearchResult;

  /**
   * 执行安装（下载 + 解压 + 加载）
   * @param skillId 技能 ID
   * @param sourceUrl 来源 URL（可选）
   * @returns 安装后的内部技能对象
   */
  protected abstract doInstall(skillId: string, sourceUrl?: string): Promise<T>;

  /**
   * 执行卸载（删除文件）
   * @param skill 已安装的技能
   */
  protected abstract doUninstall(skill: T): Promise<void>;

  /**
   * 远程搜索（在对应市场中查询）
   * @param query 搜索关键字
   */
  protected abstract doSearchRemote(
    query: string
  ): Promise<ThirdPartySkillSearchResult[]>;

  // ============================================================
  // 模板方法 — 通用实现
  // ============================================================

  /**
   * 初始化适配器
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      await this.localStore.initialize();
      logger.info(`${this.displayName} 初始化完成`);
      this.initialized = true;
      this.emit('initialized');
    } catch (error) {
      logger.error(`${this.displayName} 初始化失败`, error as Error);
      throw error;
    }
  }

  /**
   * 设置 SkillRegistry 引用
   * @param registry SkillRegistry 实例
   */
  setSkillRegistry(registry: SkillRegistry): void {
    this.skillRegistry = registry;
  }

  /**
   * 获取技能来源标识
   */
  getSource(): SkillSource {
    return SkillSource.THIRD_PARTY;
  }

  /**
   * 加载所有已安装技能（SkillLoader 接口）
   */
  async loadSkills(): Promise<Skill[]> {
    const installed = await this.localStore.getAllSkills();
    return installed.filter((s) => s.enabled).map((s) => this.toSkill(s));
  }

  /**
   * 搜索技能（本地 + 远程）
   * @param query 搜索关键词
   */
  async searchSkills(query: string): Promise<ThirdPartySkillSearchResult[]> {
    const [localResults, remoteResults] = await Promise.all([
      this.localStore.searchLocal(query),
      this.doSearchRemote(query).catch(
        () => [] as ThirdPartySkillSearchResult[]
      ),
    ]);

    const installedIds = new Set(localResults.map((r) => r.skill.id));

    const merged: ThirdPartySkillSearchResult[] = [
      ...localResults.map((r) => ({
        id: r.skill.id,
        name: r.skill.name,
        version: r.skill.version,
        description: r.skill.description,
        author: r.skill.author,
        license: r.skill.license,
        category: r.skill.category,
        tags: r.skill.tags,
        score: r.score,
        installed: true,
      })),
      ...remoteResults
        .filter((r) => !installedIds.has(r.id))
        .map((r) => ({ ...r, installed: false })),
    ];

    return merged;
  }

  /**
   * 安装技能
   * @param skillId 技能 ID
   * @param sourceUrl 来源 URL（可选）
   */
  async installSkill(
    skillId: string,
    sourceUrl?: string
  ): Promise<Skill | null> {
    try {
      const installed = await this.doInstall(skillId, sourceUrl);

      await this.localStore.addSkill(installed);

      this.emit('skill:installed', installed);
      logger.info(
        `技能已安装: ${installed.meta.name}@${installed.meta.version}`
      );

      this.auditService.recordInstall(
        installed.meta.id,
        installed.meta.name,
        installed.meta.version,
        true
      );

      // 同步通知 SkillRegistry
      const unifiedSkill = this.toSkill(installed);
      if (this.skillRegistry) {
        this.skillRegistry.register(unifiedSkill);
      }

      return unifiedSkill;
    } catch (error) {
      logger.error(`安装技能失败: ${skillId}`, error as Error);
      return null;
    }
  }

  /**
   * 卸载技能
   * @param skillId 技能 ID
   */
  async uninstallSkill(skillId: string): Promise<boolean> {
    try {
      const skill = await this.localStore.getSkill(skillId);
      if (!skill) {
        logger.warn(`技能未安装: ${skillId}`);
        return false;
      }

      await this.doUninstall(skill);
      await this.localStore.removeSkill(skillId);

      this.emit('skill:uninstalled', { id: skillId });
      logger.info(`技能已卸载: ${skillId}`);

      // 同步通知 SkillRegistry
      if (this.skillRegistry) {
        this.skillRegistry.unregister(skillId);
      }

      this.auditService.recordUninstall(skill.meta.id, skill.meta.name);
      return true;
    } catch (error) {
      logger.error(`卸载技能失败: ${skillId}`, error as Error);
      return false;
    }
  }

  /**
   * 获取技能详情
   * @param skillId 技能 ID
   */
  async getSkillDetail(
    skillId: string
  ): Promise<ThirdPartySkillSearchResult | null> {
    const skill = await this.localStore.getSkill(skillId);
    if (!skill) return null;

    return this.toSearchResult(skill);
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
   * 获取已安装技能列表
   */
  async getInstalledSkills(): Promise<T[]> {
    return this.localStore.getAllSkills();
  }

  /**
   * 获取本地技能存储
   */
  getLocalStore(): LocalSkillStore<T> {
    return this.localStore;
  }

  /**
   * 获取审计服务
   */
  getAuditService(): SkillAuditService {
    return this.auditService;
  }
}
