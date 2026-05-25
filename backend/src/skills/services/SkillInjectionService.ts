/**
 * 技能注入服务
 * 三级缓存 + 条件激活
 * 管理技能的加载、缓存、条件匹配和系统提示注入
 */

import { readdir, readFile, mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import type { Skill } from '../types';
import { SkillSource } from '../types';
import { SkillParser, type SkillDefinition } from '../utils/skillParser';
import {
  SkillConditionMatcher,
  type ConditionContext,
} from '../SkillConditionMatcher';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 技能注入配置
 */
export interface SkillInjectionConfig {
  skillsDirs: string[];
  builtinSkillsDir?: string;
  maxActiveSkills: number;
  cacheTtlMs: number;
  enableL2Cache: boolean;
  enableL3Cache: boolean;
  enableSnapshotCache: boolean;
  snapshotCachePath?: string;
}

/**
 * 三级缓存容器
 */
interface SkillCache {
  /** L1: 当前激活的技能（内存中最快） */
  l1: Map<string, Skill>;
  /** L2: 已解析的技能定义（disk→parsed） */
  l2: Map<string, SkillDefinition>;
  /** L3: 源文件元数据（disk→file info） */
  l3: Map<string, { path: string; mtimeMs: number }>;
  /** L2.5: 磁盘快照缓存（序列化后的注入提示词） */
  snapshotPrompt: string | null;
  snapshotMtime: string;
  /** L2 上次刷新时间 */
  lastRefresh: number;
}

const DEFAULT_CONFIG: SkillInjectionConfig = {
  skillsDirs: [join(homedir(), '.pyapp', 'skills')],
  builtinSkillsDir: '',
  maxActiveSkills: 10,
  cacheTtlMs: 300_000,
  enableL2Cache: true,
  enableL3Cache: true,
  enableSnapshotCache: true,
  snapshotCachePath: join(
    homedir(),
    '.pyapp',
    'cache',
    'skills_prompt_snapshot.json'
  ),
};

/**
 * 技能注入服务
 * 维护三级缓存，提供条件激活和系统提示注入能力
 */
export class SkillInjectionService {
  private config: SkillInjectionConfig;
  private cache: SkillCache;
  private matcher: SkillConditionMatcher;
  private listeners: Array<() => void> = [];

  constructor(config?: Partial<SkillInjectionConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.cache = {
      l1: new Map(),
      l2: new Map(),
      l3: new Map(),
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
   * 刷新所有缓存层
   */
  async refreshAll(): Promise<void> {
    await this.refreshL3();
    await this.refreshL2();
    this.refreshL1();
    this.cache.lastRefresh = Date.now();
    await this.writeSnapshotCache();
  }

  /**
   * 刷新 L3：扫描源文件目录
   */
  private async refreshL3(): Promise<void> {
    if (!this.config.enableL3Cache) return;
    this.cache.l3.clear();

    const scanDir = async (
      dir: string,
      isSubdirStyle: boolean
    ): Promise<void> => {
      if (!existsSync(dir)) return;
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          let skillName: string;
          let fullPath: string;
          if (isSubdirStyle) {
            if (!entry.isDirectory()) continue;
            const skillFile = join(dir, entry.name, 'SKILL.md');
            if (!existsSync(skillFile)) continue;
            skillName = entry.name;
            fullPath = skillFile;
          } else {
            if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
            skillName = entry.name.replace(/\.md$/, '');
            fullPath = join(dir, entry.name);
          }
          const stats = await readFile(fullPath).then(
            () => ({ mtimeMs: Date.now() }),
            () => ({ mtimeMs: 0 })
          );
          this.cache.l3.set(skillName, {
            path: fullPath,
            mtimeMs: stats.mtimeMs,
          });
        }
      } catch (error) {
        logger.warn(`L3 cache refresh failed for ${dir}`, {
          error: String(error),
        });
      }
    };

    for (const dir of this.config.skillsDirs) {
      await scanDir(dir, false);
    }

    if (this.config.builtinSkillsDir) {
      await scanDir(this.config.builtinSkillsDir, true);
    }
  }

  /**
   * 刷新 L2：解析技能定义
   */
  private async refreshL2(): Promise<void> {
    if (!this.config.enableL2Cache) return;

    for (const [name, meta] of this.cache.l3) {
      try {
        const content = await readFile(meta.path, 'utf-8');
        const parser = new SkillParser();
        const definition = await parser.parseSkillFile(
          meta.path,
          SkillSource.USER
        );
        this.cache.l2.set(name, definition);
      } catch (error) {
        logger.warn(`L2 cache refresh failed for ${name}`, {
          error: String(error),
        });
      }
    }
  }

  /**
   * 刷新 L1：条件激活
   */
  private refreshL1(): void {
    this.cache.l1.clear();
    let activated = 0;

    for (const [, def] of this.cache.l2) {
      if (activated >= this.config.maxActiveSkills) break;
      if (
        this.matcher.evaluate(
          (def.frontmatter ?? {}) as unknown as Record<string, unknown>
        )
      ) {
        this.cache.l1.set(def.name, this.definitionToSkill(def));
        activated++;
      }
    }

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
   * 生成可供 LLM 感知的可用技能描述，
   * 追加到系统提示末尾，使 Agent 能够在推理中利用可用技能。
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
          type: 'prompt',
          name: s.name,
          description: s.description,
          hasUserSpecifiedDescription: false,
          allowedTools: s.allowedTools ?? [],
          userInvocable: true,
          disableModelInvocation: false,
          contentLength: s.contentLength,
          isHidden: false,
          progressMessage: `Executing ${s.name}...`,
          source: s.source ?? SkillSource.USER,
          loadedFrom: '',
          userFacingName: () => s.name,
          getPromptForCommand: async () => [{ type: 'text', text: '' }],
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
   * 计算 L3 源文件的 mtime 签名
   */
  private async computeSnapshotMtime(): Promise<string> {
    const entries = Array.from(this.cache.l3.entries());
    entries.sort(([a], [b]) => a.localeCompare(b));
    return entries.map(([name, meta]) => `${name}:${meta.mtimeMs}`).join('|');
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
   * 转换 SkillDefinition 为 Skill
   */
  private definitionToSkill(def: SkillDefinition): Skill {
    return {
      type: 'prompt',
      name: def.name,
      description: def.description ?? '',
      hasUserSpecifiedDescription: false,
      allowedTools: (def.frontmatter?.['allowed-tools'] as string[]) ?? [],
      userInvocable: (def.frontmatter?.['user-invocable'] as boolean) ?? true,
      disableModelInvocation:
        (def.frontmatter?.['disable-model-invocation'] as boolean) ?? false,
      contentLength: def.content?.length ?? 0,
      isHidden: false,
      progressMessage: `Executing ${def.name}...`,
      source:
        (def.frontmatter?.['skill-source'] as SkillSource) ?? SkillSource.USER,
      loadedFrom: def.filePath ?? '',
      userFacingName: () => def.name,
      getPromptForCommand: async () => [{ type: 'text', text: def.content }],
    };
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
