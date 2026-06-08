/**
 * 技能注入服务
 * 三级缓存 + 条件激活
 * 管理技能的加载、缓存、条件匹配和系统提示注入
 *
 * 数据源：SkillRegistry（唯一事实来源），不再自建文件扫描管线
 */

import { readFile, mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import type { Skill } from '../types';
import { SkillSource, SkillLoadMethod } from '../types';
import { SkillRegistry } from '../SkillRegistry';
import {
  SkillConditionMatcher,
  type ConditionContext,
} from '../SkillConditionMatcher';
import { resolvePyappHome } from '@modules/core/paths';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 技能注入配置
 */
export interface SkillInjectionConfig {
  /** 最大激活技能数 */
  maxActiveSkills: number;
  /** 快照缓存 TTL（ms） */
  cacheTtlMs: number;
  /** 是否启用快照缓存 */
  enableSnapshotCache: boolean;
  /** 快照缓存路径 */
  snapshotCachePath?: string;
}

/**
 * 缓存容器
 */
interface SkillCache {
  /** L1: 当前条件激活的技能 */
  l1: Map<string, Skill>;
  /** L2.5: 磁盘快照缓存 */
  snapshotPrompt: string | null;
  snapshotMtime: string;
  /** 上次刷新时间 */
  lastRefresh: number;
}

const DEFAULT_CONFIG: SkillInjectionConfig = {
  maxActiveSkills: 10,
  cacheTtlMs: 300_000,
  enableSnapshotCache: true,
  snapshotCachePath: join(
    resolvePyappHome(),
    'cache',
    'skills_prompt_snapshot.json'
  ),
};

/**
 * 技能注入服务
 * 从 SkillRegistry 读取技能，应用条件匹配后注入到系统提示
 */
export class SkillInjectionService {
  private config: SkillInjectionConfig;
  private cache: SkillCache;
  private matcher: SkillConditionMatcher;
  private registry: SkillRegistry;
  private listeners: Array<() => void> = [];

  /**
   * @param registry SkillRegistry 实例（不传则新建）
   * @param config 可选配置
   */
  constructor(registry?: SkillRegistry, config?: Partial<SkillInjectionConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.registry = registry ?? new SkillRegistry();
    this.cache = {
      l1: new Map(),
      snapshotPrompt: null,
      snapshotMtime: '',
      lastRefresh: 0,
    };
    this.matcher = new SkillConditionMatcher({
      platform: process.platform,
      os: process.platform,
    });
  }

  /**
   * 设置 SkillRegistry 实例
   */
  setRegistry(registry: SkillRegistry): void {
    this.registry = registry;
    this.invalidateCache();
  }

  /**
   * 更新条件上下文
   */
  updateConditionContext(updates: Partial<ConditionContext>): void {
    this.matcher.updateContext(updates);
  }

  /**
   * 注册条件变更监听
   */
  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  /**
   * 刷新：从 Registry 同步技能，重新应用条件匹配
   */
  async refreshAll(): Promise<void> {
    this.cache.l1.clear();

    const allSkills = this.registry.getAll();
    let activated = 0;

    for (const skill of allSkills) {
      if (activated >= this.config.maxActiveSkills) break;
      if (
        this.matcher.evaluate(
          (skill.config ?? {}) as unknown as Record<string, unknown>
        )
      ) {
        this.cache.l1.set(skill.name, skill);
        activated++;
      }
    }

    this.cache.lastRefresh = Date.now();
    await this.writeSnapshotCache();
    this.notifyListeners();
  }

  /**
   * 获取激活的技能列表
   */
  getActiveSkills(): Skill[] {
    return Array.from(this.cache.l1.values());
  }

  /**
   * 获取技能注入提示词（XML 格式）
   * 对标 Hermes <available_skills><skill> XML 格式
   */
  getInjectionPrompt(): string {
    const active = this.getActiveSkills();
    if (active.length === 0) return '';

    const parts: string[] = ['<available_skills>'];
    for (const s of active) {
      parts.push('  <skill>');
      parts.push(`    <name>${this.escapeXml(s.name)}</name>`);
      parts.push(
        `    <description>${this.escapeXml(s.description)}</description>`
      );
      if (s.allowedTools?.length) {
        parts.push(
          `    <allowed_tools>${s.allowedTools.map((t) => this.escapeXml(t)).join(',')}</allowed_tools>`
        );
      }
      parts.push('  </skill>');
    }
    parts.push('</available_skills>');

    return parts.join('\n');
  }

  /**
   * 构建技能上下文，注入到系统提示中
   * 对标 Hermes SkillInjector.inject_skills()
   *
   * @param systemPrompt 原始系统提示
   * @returns 注入技能描述后的系统提示
   */
  buildSkillContext(systemPrompt: string): string {
    const active = this.getActiveSkills();
    if (active.length === 0) return systemPrompt;

    const descriptions = active
      .map((s) => `- ${s.name}: ${s.description || '(无描述)'}`)
      .join('\n');

    const injectionBlock = [
      '',
      '以下是当前可用的技能列表。当用户请求与技能描述匹配时，',
      '可以调用对应技能来完成该任务：',
      '',
      descriptions,
      '',
    ].join('\n');

    return `${systemPrompt}\n${injectionBlock}`;
  }

  /**
   * 检查缓存是否过期
   */
  isCacheStale(): boolean {
    return Date.now() - this.cache.lastRefresh > this.config.cacheTtlMs;
  }

  /**
   * 确保缓存最新
   * 优先尝试磁盘快照缓存，失效则全量刷新
   */
  async ensureFresh(): Promise<void> {
    if (!this.isCacheStale() && this.cache.l1.size > 0) return;

    if (this.config.enableSnapshotCache) {
      const loaded = await this.loadSnapshotCache();
      if (loaded) return;
    }

    await this.refreshAll();
  }

  /**
   * 加载磁盘快照缓存（L2.5）
   */
  private async loadSnapshotCache(): Promise<boolean> {
    const cachePath = this.config.snapshotCachePath;
    if (!cachePath) return false;
    if (!existsSync(cachePath)) return false;

    try {
      const raw = await readFile(cachePath, 'utf-8');
      const snapshot = JSON.parse(raw) as {
        prompt: string;
        mtime: string;
        skills: Array<{
          name: string;
          description: string;
          contentLength: number;
          allowedTools: string[];
          source: SkillSource;
        }>;
      };

      const currentMtime = await this.computeSnapshotMtime();
      if (currentMtime !== snapshot.mtime) return false;

      this.cache.l1.clear();
      for (const s of snapshot.skills) {
        const skill: Skill = {
          name: s.name,
          description: s.description,
          source: s.source ?? SkillSource.THIRD_PARTY,
          loadMethod: SkillLoadMethod.FILE_SYSTEM,
          loadedFrom: '',
          allowedTools: s.allowedTools ?? [],
          userInvocable: true,
          disableModelInvocation: false,
          contentLength: s.contentLength,
          isHidden: false,
          progressMessage: `Executing ${s.name}...`,
          impl: {
            kind: 'prompt',
            getPromptForCommand: async () => [{ type: 'text', text: '' }],
          },
        };
        this.cache.l1.set(s.name, skill);
      }

      this.cache.snapshotPrompt = snapshot.prompt;
      this.cache.snapshotMtime = snapshot.mtime;
      this.cache.lastRefresh = Date.now();

      logger.debug(`Snapshot cache loaded: ${snapshot.skills.length} skills`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 写入磁盘快照缓存（L2.5）
   */
  private async writeSnapshotCache(): Promise<void> {
    if (!this.config.enableSnapshotCache) return;
    const cachePath = this.config.snapshotCachePath;
    if (!cachePath) return;

    const active = this.getActiveSkills();
    if (active.length === 0) return;

    try {
      const cacheDir = cachePath.substring(
        0,
        Math.max(cachePath.lastIndexOf('/'), cachePath.lastIndexOf('\\'))
      );
      if (cacheDir && !existsSync(cacheDir)) {
        await mkdir(cacheDir, { recursive: true });
      }

      const mtime = await this.computeSnapshotMtime();
      const prompt = this.getInjectionPrompt();

      const snapshot = {
        prompt,
        mtime,
        skills: active.map((s) => ({
          name: s.name,
          description: s.description,
          contentLength: s.contentLength,
          allowedTools: s.allowedTools,
          source: s.source,
        })),
      };

      await writeFile(cachePath, JSON.stringify(snapshot, null, 2), 'utf-8');
      this.cache.snapshotPrompt = prompt;
      this.cache.snapshotMtime = mtime;
      logger.debug(`Snapshot cache written: ${active.length} skills`);
    } catch (error) {
      logger.warn('Failed to write snapshot cache', { error: String(error) });
    }
  }

  /**
   * 计算快照 mtime 签名
   */
  private async computeSnapshotMtime(): Promise<string> {
    const allSkills = this.registry.getAll();
    const entries = allSkills
      .map((s) => `${s.name}:${s.version ?? '1.0.0'}`)
      .sort();
    return entries.join('|');
  }

  /**
   * XML 转义
   */
  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * 使缓存失效
   */
  private invalidateCache(): void {
    this.cache.l1.clear();
    this.cache.lastRefresh = 0;
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* ignore */
      }
    }
  }
}
