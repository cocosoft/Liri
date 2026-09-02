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
import { createHash } from 'crypto';
import { getLogger, getOTelTracing } from '@modules/monitoring';
import { handleError } from '@modules/error';
import type { Skill } from '../types';
import { SkillSource, SkillLoadMethod } from '../types';
import { SkillRegistry } from '../SkillRegistry';
import {
  SkillConditionMatcher,
  type ConditionContext,
} from '../SkillConditionMatcher';
import { resolvePyappHome } from '@modules/core';

/** 辅助：找数组最后一个满足条件的元素索引 */
function findLastIndex<T>(arr: T[], predicate: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i])) return i;
  }
  return -1;
}

const logger = getLogger('skills:services:SkillInjectionService');

/**
 * 技能注入配置
 */
export interface SkillInjectionConfig {
  /**
   * 最大激活技能数（兼容保留）。
   * 2026-09-01 根源修复：渐进披露（仅列技能名索引）下不再截断注入列表，
   * 全部 prompt 型启用技能均对模型可见；本字段仅作历史兼容，不再参与截断。
   */
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
  constructor(
    registry?: SkillRegistry,
    config?: Partial<SkillInjectionConfig>
  ) {
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
    // BUG-7（2026-08-30）：条件变更立即失效缓存——否则 ensureFresh 在 TTL
    // （5 分钟）内直接返回旧列表，条件变更最长 5 分钟技能不更新。
    this.invalidateCache();
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
    await getOTelTracing().wrap(
      { name: 'skill.injection.refreshAll' },
      async () => {
        this.cache.l1.clear();

        const allSkills = this.registry.getAll();
        // T2（2026-08-30）：展示=可执行——仅注入 SkillTool 可执行的 prompt 型且启用技能
        // （BUG-2：注入列表不得含不可执行技能，否则模型调用返回 Skill not found）
        const eligible = allSkills.filter(
          (skill) =>
            skill.impl.kind === 'prompt' &&
            !(skill.isEnabled && skill.isEnabled() === false)
        );
        // T6（2026-08-30）：先收集所有满足条件的技能再截断，修复 BUG-1 的 break 早退
        // （新技能排在 registry 末尾时被前 10 个永久挤出）；按最近使用/安装时间排序，
        // 无溯源记录回退 registry 顺序（SkillProvenanceTracker 零依赖）。
        const matched = eligible.filter((skill) =>
          this.matcher.evaluate(
            (skill.config ?? {}) as unknown as Record<string, unknown>
          )
        );
        const ordered = await this.rankSkills(matched);
        // 根源修复（2026-09-01）：不再按 maxActiveSkills 截断——
        // 注入已改为渐进披露（getInjectionPrompt 仅列技能名索引，token 极小），
        // 截断是旧"描述注入"时代的历史遗留：用户新增技能按注册顺序靠后会被挤出，
        // 模型永远不知道其存在（"添加的技能死活找不到"根因）。索引全量注入，
        // 任意数量技能均对模型可见。
        for (const skill of ordered) {
          this.cache.l1.set(skill.name, skill);
        }

        this.cache.lastRefresh = Date.now();
        await this.writeSnapshotCache();
        this.notifyListeners();
        logger.info('SkillInjectionService.refreshAll', {
          total: allSkills.length,
          eligible: eligible.length,
          matched: matched.length,
          activated: this.cache.l1.size,
        });
      }
    )();
  }

  /**
   * T6（2026-08-30）：技能激活排序——最近使用/安装优先（SkillProvenanceTracker.updatedAt），
   * 无溯源记录保持 registry 顺序（稳定次序）。
   * 动态 import SkillProvenanceTracker：避免顶层静态 import 引入循环依赖
   * （systemPromptSections 构造 SkillInjectionService 时 TDZ）。
   */
  private async rankSkills(skills: Skill[]): Promise<Skill[]> {
    try {
      const { skillProvenanceTracker } =
        await import('../SkillProvenanceTracker');
      const provenances = skillProvenanceTracker.getAllProvenances();
      if (provenances.length === 0) {
        // 用户/第三方技能优先于内置（2026-09-01）：
        // 注入列表已全量（不再截断），排序仅影响注入顺序——用户技能靠前更易被模型优先采用。
        return [...skills].sort((a, b) => {
          const aUser =
            a.loadedFrom === 'user' || a.source !== SkillSource.BUILTIN;
          const bUser =
            b.loadedFrom === 'user' || b.source !== SkillSource.BUILTIN;
          if (aUser !== bUser) return aUser ? -1 : 1;
          return 0; // 同类保持稳定顺序
        });
      }
      const updatedAtByName = new Map(
        provenances.map((p) => [p.skillName, p.updatedAt])
      );
      return [...skills].sort(
        (a, b) =>
          (updatedAtByName.get(b.name) ?? 0) -
          (updatedAtByName.get(a.name) ?? 0)
      );
    } catch {
      // 溯源不可用时回退稳定次序
      return skills;
    }
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
   *
   * T9'（2026-08-30）：渐进式披露——注入块仅列技能名（索引，token 高效），
   * 描述与正文由 skills_list / skill_view 按需加载（对齐 hermes progressive disclosure，
   * 缓解 M-2 token 双份）。
   */
  getInjectionPrompt(): string {
    const active = this.getActiveSkills();
    if (active.length === 0) return '';

    const parts: string[] = ['<available_skills>'];
    for (const s of active) {
      parts.push(`  <skill><name>${this.escapeXml(s.name)}</name></skill>`);
    }
    parts.push('</available_skills>');
    parts.push(
      '用 skills_list 查看全部技能与描述；用 skill_view(name) 加载完整内容；用 Skill 工具执行技能。'
    );

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
        checksum?: string;
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

      // S2-4：弱完整性校验 —— checksum 不匹配视为损坏缓存，重建
      if (snapshot.checksum) {
        const expected = createHash('sha256')
          .update(`${snapshot.prompt}|${JSON.stringify(snapshot.skills)}`)
          .digest('hex');
        if (expected !== snapshot.checksum) return false;
      }

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

      // BUG-8（2026-08-30）：快照恢复后重新应用条件匹配——快照是历史某次 refreshAll
      // 的结果，若条件上下文（平台/OS/会话）已变化，快照里的技能会绕过 matcher 直接
      // 可用。同时与 refreshAll 对齐：仅保留 prompt 型 + 启用（BUG-2 展示=可执行）。
      if (this.cache.l1.size > 0) {
        for (const [name, skill] of [...this.cache.l1]) {
          if (
            skill.impl.kind !== 'prompt' ||
            (skill.isEnabled && skill.isEnabled() === false) ||
            !this.matcher.evaluate(
              (skill.config ?? {}) as unknown as Record<string, unknown>
            )
          ) {
            this.cache.l1.delete(name);
          }
        }
      }

      logger.debug(`Snapshot cache loaded: ${snapshot.skills.length} skills`);
      return true;
    } catch (err) {
      // @ignore-catch — 快照缓存损坏/不可读属降级路径，回退 refreshAll 全量刷新（CS03）
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

      const skills = active.map((s) => ({
        name: s.name,
        description: s.description,
        contentLength: s.contentLength,
        allowedTools: s.allowedTools,
        source: s.source,
      }));
      // S2-4：弱完整性校验 —— 落盘时带 checksum，加载时校验防缓存损坏
      const checksum = createHash('sha256')
        .update(`${prompt}|${JSON.stringify(skills)}`)
        .digest('hex');

      const snapshot = {
        prompt,
        mtime,
        checksum,
        skills,
      };

      await writeFile(cachePath, JSON.stringify(snapshot, null, 2), 'utf-8');
      this.cache.snapshotPrompt = prompt;
      this.cache.snapshotMtime = mtime;
      logger.debug(`Snapshot cache written: ${active.length} skills`);
    } catch (error) {
      // §1.9：统一 handleError；快照写失败不阻断主流程（仅性能优化，可重建）
      handleError(error, {
        module: 'skills:services:SkillInjectionService',
        action: 'writeSnapshotCache',
      }).catch(() => {});
    }
  }

  /**
   * 计算快照 mtime 签名（S2-4：加入内容哈希与内容长度，版本号不变但内容变化时缓存失效）
   */
  private async computeSnapshotMtime(): Promise<string> {
    // A2（2026-09-01）：基于 active 技能（与 writeSnapshotCache 的 prompt 同源）——
    // 原实现遍历 registry.getAll()（全部技能，含被 maxActiveSkills 截断的），
    // 导致 mtime 含 zhihu 但 prompt 不含 → ensureFresh 校验"通过"却加载旧 prompt，
    // 被挤出注入列表的技能（zhihu/doc-workflow）永不可见。同源后技能集变化即失配重建。
    const allSkills = this.getActiveSkills();
    const entries: string[] = [];
    for (const s of allSkills) {
      let contentHash = '';
      if (s.impl.kind === 'prompt') {
        try {
          const prompts = await s.impl.getPromptForCommand('', {});
          contentHash = createHash('sha256')
            .update(JSON.stringify(prompts ?? []))
            .digest('hex')
            .slice(0, 8);
        } catch {
          /* 内容不可得时仅用元数据签名 */
        }
      }
      entries.push(
        `${s.name}:${s.version ?? '1.0.0'}:${s.contentLength ?? 0}:${contentHash}`
      );
    }
    return entries.sort().join('|');
  }

  /**
   * P1-3: 将 Skills 注入到消息历史（用于每次上下文组装时调用）
   * 确保压缩后 skills 列表仍然存在于最新一批消息中。
   *
   * 对标 hermes-agent：Skills 作为 User Message 注入，不破坏 System Prompt 缓存。
   *
   * @param messages 当前消息列表
   * @returns 注入 skills 块后的消息列表（如无激活技能则原样返回）
   */
  injectSkillsIntoMessageHistory(
    messages: Array<{
      role: string;
      content: string;
      metadata?: Record<string, unknown>;
    }>
  ): Array<{
    role: string;
    content: string;
    metadata?: Record<string, unknown>;
  }> {
    const active = this.getActiveSkills();
    if (active.length === 0) return messages;

    const prompt = this.getInjectionPrompt();
    if (!prompt) return messages;

    // T1（2026-08-30）：幂等去重——先移除已有注入块，再定位真实最后一条 user 消息。
    // 双重识别：metadata.__skills_injection 标记 + 内容级兜底（compaction 若丢失 metadata
    // 透传，仍可按 <available_skills> 内容特征去重，M-5）。修复 BUG-5 重复累积
    // （truncateApiMessages 每次调用注入一份，且 findLastIndex 可能命中旧注入块自身）。
    const isInjection = (m: {
      role: string;
      content: string;
      metadata?: Record<string, unknown>;
    }): boolean =>
      m.metadata?.__skills_injection === true ||
      (typeof m.content === 'string' &&
        m.content.includes('<available_skills>'));

    const result = messages.filter((m) => !isInjection(m));

    // 在最后一条真实 user message 前插入 skills 注入块
    const lastUserIdx = findLastIndex(result, (m) => m.role === 'user');
    if (lastUserIdx === -1) return result;
    result.splice(lastUserIdx, 0, {
      role: 'user',
      content: prompt,
      metadata: { __skills_injection: true },
    });
    return result;
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
      } catch (err) {
        // @ignore-catch — 监听器回调失败不影响刷新主流程（CS03）
      }
    }
  }
}
