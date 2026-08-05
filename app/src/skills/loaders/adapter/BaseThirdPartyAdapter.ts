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
import { existsSync, renameSync, rmSync } from 'fs';
import { Logger, LogLevel } from '@modules/monitoring';
import { SkillSource, SkillLoadMethod } from '@modules/skills/types';
import type { Skill } from '@modules/skills/types';
import type { SkillRegistry } from '@modules/skills/SkillRegistry';
import {
  loadBuiltinEnabled,
  persistBuiltinEnabled,
} from '@modules/skills/BuiltinEnabledStore';
import { LocalSkillStore } from './LocalSkillStore';
import { SkillAuditService } from './SkillAuditService';
import { SkillSearchEngine } from './SkillSearchEngine';
import type {
  ThirdPartySkillAdapter,
  ThirdPartySkillSearchResult,
} from './ThirdPartySkillAdapter';
import type { InstalledThirdPartySkill } from './types';

const logger = new Logger({
  module: 'skills:baseAdapter',
  level: LogLevel.INFO,
});

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

  /** 搜索引擎（懒创建缓存） */
  private searchEngine: SkillSearchEngine | null = null;

  /** per-skillId 单飞锁（v1.5 阶段 3.6：防 install/update/uninstall 并发竞态） */
  private skillLocks = new Map<string, Promise<unknown>>();

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
   * @param targetPath 安装目标路径（可选；用于 updateSkill 原子替换下载到临时目录）
   * @returns 安装后的内部技能对象
   */
  protected abstract doInstall(
    skillId: string,
    sourceUrl?: string,
    targetPath?: string
  ): Promise<T>;

  /**
   * 执行卸载（删除文件）
   * @param skill 已安装的技能
   */
  protected abstract doUninstall(skill: T): Promise<void>;

  /**
   * 远程搜索（在对应市场中查询）
   * @param query 搜索关键字
   * @param opts 过滤条件（category/tags/source，v1.5 透传修复）
   */
  protected abstract doSearchRemote(
    query: string,
    opts?: { category?: string; tags?: string[]; source?: string }
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
      this.recoverFromCrashes();
      logger.info(`${this.displayName} 初始化完成`);
      this.initialized = true;
      this.emit('initialized');
    } catch (error) {
      logger.error(`${this.displayName} 初始化失败`, error as Error);
      throw error;
    }
  }

  /**
   * 5.5：.bak 崩溃恢复 + .tmp 残留清理
   * 启动时遍历已安装技能：正式目录缺失且 `.bak` 存在 → 自动还原；
   * 清理 updateSkill 中断残留的 `.tmp` 目录。失败仅告警，不影响启动。
   */
  private recoverFromCrashes(): void {
    try {
      const installed = this.localStore.getAllSkillsSync();
      for (const skill of installed) {
        const installPath = (skill as { installPath?: string }).installPath;
        if (!installPath) continue;

        const bakPath = `${installPath}.bak`;
        if (!existsSync(installPath) && existsSync(bakPath)) {
          renameSync(bakPath, installPath);
          logger.warn(`崩溃恢复：已从 .bak 还原技能目录 ${installPath}`);
        }

        const tmpPath = `${installPath}.tmp`;
        if (existsSync(tmpPath)) {
          rmSync(tmpPath, { recursive: true, force: true });
          logger.warn(`崩溃恢复：已清理 .tmp 残留 ${tmpPath}`);
        }
      }
    } catch (error) {
      logger.warn('崩溃恢复扫描失败，跳过（不影响启动）', error as Error);
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
   * @param opts 过滤条件（v1.5 三处透传：聚合层 → 本地 searchLocal → 远程 doSearchRemote）
   */
  async searchSkills(
    query: string,
    opts?: { category?: string; tags?: string[]; source?: string }
  ): Promise<ThirdPartySkillSearchResult[]> {
    const [localResults, remoteResults] = await Promise.all([
      this.localStore.searchLocal(query, {
        category: opts?.category,
        tags: opts?.tags,
      }),
      this.doSearchRemote(query, opts).catch(
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
   * per-skillId 单飞锁：同一技能的 install/update/uninstall 串行执行，防 TOCTOU 竞态
   */
  private withSkillLock<T>(skillId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.skillLocks.get(skillId) || Promise.resolve();
    const next = prev.then(fn, fn);
    this.skillLocks.set(skillId, next);
    const cleanup = (): void => {
      if (this.skillLocks.get(skillId) === next) {
        this.skillLocks.delete(skillId);
      }
    };
    next.then(cleanup, cleanup);
    return next;
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
    return this.withSkillLock(skillId, async () => {
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
    });
  }

  /**
   * 更新技能（v1.5 阶段 1，修复 P0-1）
   * 从索引读取 sourceUrl → 下载到临时目录 → 原子替换（旧目录 .bak → 新目录 → 删 .bak）→
   * 更新索引 → 同步 SkillRegistry。失败自动回滚并保留旧版本。
   * @param skillId 技能 ID
   * @returns 更新后的统一 Skill（失败返回 null）
   */
  async updateSkill(skillId: string): Promise<Skill | null> {
    return this.withSkillLock(skillId, async () => {
      const existing = await this.localStore.getSkill(skillId);
      if (!existing) {
        logger.warn(`技能未安装，无法更新: ${skillId}`);
        return null;
      }

      const installPath = existing.installPath;
      const tmpPath = `${installPath}.tmp`;
      const bakPath = `${installPath}.bak`;

      try {
        // 1. 重新拉取到临时目录（不触碰正式目录）
        const updated = await this.doInstall(
          skillId,
          existing.sourceUrl,
          tmpPath
        );

        // 2. 原子替换：正式 → .bak，临时 → 正式
        if (existsSync(installPath)) {
          renameSync(installPath, bakPath);
        }
        if (existsSync(tmpPath)) {
          renameSync(tmpPath, installPath);
        }

        // 3. 清理 .bak
        if (existsSync(bakPath)) {
          rmSync(bakPath, { recursive: true, force: true });
        }

        // 4. 更新索引（修正 installPath 为正式路径）
        updated.installPath = installPath;
        updated.updatedAt = Date.now();
        await this.localStore.updateSkill(skillId, updated);

        // 5. 同步 SkillRegistry（替换旧注册）
        const unifiedSkill = this.toSkill(updated);
        if (this.skillRegistry) {
          if (this.skillRegistry.has(skillId, { includeDisabled: true })) {
            this.skillRegistry.unregister(skillId);
          }
          this.skillRegistry.register(unifiedSkill);
        }

        this.auditService.recordUpdate(
          skillId,
          existing.meta.name,
          existing.meta.version,
          updated.meta.version,
          true
        );
        logger.info(`技能已更新: ${skillId} -> v${updated.meta.version}`);
        return unifiedSkill;
      } catch (error) {
        // 回滚：正式目录缺失且 .bak 存在 → 还原旧版本
        if (!existsSync(installPath) && existsSync(bakPath)) {
          renameSync(bakPath, installPath);
          logger.warn(`更新失败已回滚旧版本: ${skillId}`);
        }
        if (existsSync(tmpPath)) {
          rmSync(tmpPath, { recursive: true, force: true });
        }
        logger.error(`更新技能失败: ${skillId}`, error as Error);
        return null;
      }
    });
  }

  /**
   * 卸载技能
   * @param skillId 技能 ID
   */
  async uninstallSkill(skillId: string): Promise<boolean> {
    return this.withSkillLock(skillId, async () => {
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
    });
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
   * 获取技能远端最新版本（P3-23 双形态）
   * - market 形态：向来源 API 查询远端版本
   * - repo 形态（github:/hermes:/gitee:）：拉取远端 SKILL.md 解析 frontmatter version
   * 失败/不支持时返回 null（前端静默降级为"未知"，不显示"有更新"）
   * @param skillId 技能 ID
   */
  async getRemoteVersion(skillId: string): Promise<string | null> {
    return null;
  }

  /**
   * 获取搜索引擎（v1.5 阶段 1，修复 P0-2）
   * 懒创建并缓存 SkillSearchEngine 实例
   */
  getSearchEngine(): SkillSearchEngine {
    if (!this.searchEngine) {
      this.searchEngine = new SkillSearchEngine(this);
    }
    return this.searchEngine;
  }

  /**
   * 启用技能（v1.5：同步 SkillRegistry.setEnabled，触发 skill-updated 事件）
   * @param skillId 技能 ID
   */
  async enableSkill(skillId: string): Promise<void> {
    const skill = await this.localStore.getSkill(skillId);
    await this.localStore.setEnabled(skillId, true);
    if (this.skillRegistry) {
      this.skillRegistry.setEnabled(skillId, true);
      this.persistBuiltinState(skillId, true);
    }
    this.emit('skill:enabled', { id: skillId });

    if (skill) {
      this.auditService.recordToggle(skill.meta.id, skill.meta.name, true);
    }
  }

  /**
   * 禁用技能（v1.5：同步 SkillRegistry.setEnabled，触发 skill-updated 事件）
   * @param skillId 技能 ID
   */
  async disableSkill(skillId: string): Promise<void> {
    const skill = await this.localStore.getSkill(skillId);
    await this.localStore.setEnabled(skillId, false);
    if (this.skillRegistry) {
      this.skillRegistry.setEnabled(skillId, false);
      this.persistBuiltinState(skillId, false);
    }
    this.emit('skill:disabled', { id: skillId });

    if (skill) {
      this.auditService.recordToggle(skill.meta.id, skill.meta.name, false);
    }
  }

  /**
   * 内置技能启用状态持久化（3.5.7）
   * 仅当目标技能为内置（source=OFFICIAL 且 loadedFrom=builtin）时写入 builtin-enabled.json，
   * 保证"内置技能禁用后重启不复活"。非内置技能（走 index.json）不在此持久化。
   */
  private persistBuiltinState(skillId: string, enabled: boolean): void {
    const skill = this.skillRegistry?.get(skillId, { includeDisabled: true });
    if (
      !skill ||
      skill.source !== SkillSource.OFFICIAL ||
      skill.loadedFrom !== 'builtin'
    ) {
      return;
    }
    const state = loadBuiltinEnabled();
    state.set(skillId, enabled);
    persistBuiltinEnabled(state);
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
