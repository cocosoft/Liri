/**
 *
 * 技能策展器
 * 对标 Hermes curator 的 pin/archive/consolidate/patch 生命周期管理
 * 支持 7 天间隔自动调度
 * 内存缓存 + DB 持久化双重存储
 */

import type { SkillDB } from './persistence/SkillDB';

import { handleError } from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('skills:SkillCurator');

/**
 * 策展操作类型
 */
export type CuratorAction = 'pin' | 'archive' | 'consolidate' | 'patch';

/**
 * 技能策展状态
 */
export interface SkillCurationState {
  skillName: string;
  pinned: boolean;
  archived: boolean;
  consolidatedAt: number | null;
  patchedAt: number | null;
  lastCuratedAt: number | null;
  curationHistory: CuratorActionRecord[];
}

/**
 * 策展操作记录
 */
export interface CuratorActionRecord {
  action: CuratorAction;
  timestamp: number;
  details: string;
}

/**
 * 策展配置
 */
export interface CuratorConfig {
  scheduleIntervalMs: number;
  autoConsolidate: boolean;
  maxCurationHistory: number;
}

/**
 * 默认策展配置（7 天间隔）
 */
export const DEFAULT_CURATOR_CONFIG: CuratorConfig = {
  scheduleIntervalMs: 7 * 24 * 60 * 60 * 1000,
  autoConsolidate: false,
  maxCurationHistory: 100,
};

/**
 * 技能策展器
 */
export class SkillCurator {
  private states: Map<string, SkillCurationState> = new Map();
  private config: CuratorConfig;
  private scheduleTimer: ReturnType<typeof setInterval> | null = null;
  private skillDB: SkillDB | null;
  private dbInitialized = false;

  /**
   * 构造函数
   * @param config 策展配置
   * @param skillDB 可选的 DB 持久化实例
   */
  constructor(config?: Partial<CuratorConfig>, skillDB?: SkillDB) {
    this.config = { ...DEFAULT_CURATOR_CONFIG, ...config };
    this.skillDB = skillDB ?? null;
  }

  /**
   * 从 DB 加载历史策展状态
   */
  async loadFromDB(): Promise<void> {
    if (!this.skillDB || this.dbInitialized) return;

    try {
      const loaded = await this.skillDB.loadAllCuration();
      this.states = loaded;
      this.dbInitialized = true;
    } catch (err) {
      // DB 不可用时继续使用纯内存模式

      handleError(err, {
        module: 'skills:SkillCurator',
        action: 'loadCurationStates',
      });
    }
  }

  /**
   * 订阅 SkillRegistry 事件自动同步
   */
  subscribeToRegistry(registry: import('./SkillRegistry').SkillRegistry): void {
    registry.on('unregistered', (_event, skill) => {
      if (skill) {
        this.removeState(skill.name);
      }
    });

    registry.on('cleared', () => {
      this.clearAll();
    });
  }

  /**
   * 持久化当前状态到 DB
   */
  private async persistToDB(skillName: string): Promise<void> {
    if (!this.skillDB) return;

    try {
      const state = this.states.get(skillName);
      if (state) {
        await this.skillDB.saveCuration(state);
      }
    } catch (err) {
      // 静默处理 DB 错误

      handleError(err, {
        module: 'skills:SkillCurator',
        action: 'saveCuration',
      });
    }
  }

  /**
   * 获取或创建技能的策展状态
   * @param skillName 技能名称
   * @returns 策展状态
   */
  private getOrCreateState(skillName: string): SkillCurationState {
    if (!this.states.has(skillName)) {
      this.states.set(skillName, {
        skillName,
        pinned: false,
        archived: false,
        consolidatedAt: null,
        patchedAt: null,
        lastCuratedAt: null,
        curationHistory: [],
      });
    }

    return this.states.get(skillName)!;
  }

  /**
   * 固定技能（优先加载，不可被覆盖）
   * @param skillName 技能名称
   */
  pin(skillName: string): void {
    const state = this.getOrCreateState(skillName);

    state.pinned = true;
    this.recordAction(skillName, 'pin', '技能已固定');
    this.persistToDB(skillName);
  }

  /**
   * 取消固定
   * @param skillName 技能名称
   */
  unpin(skillName: string): void {
    const state = this.getOrCreateState(skillName);

    state.pinned = false;
    this.recordAction(skillName, 'pin', '技能已取消固定');
    this.persistToDB(skillName);
  }

  /**
   * 归档技能（停用但不删除）
   * @param skillName 技能名称
   */
  archive(skillName: string): void {
    const state = this.getOrCreateState(skillName);

    state.archived = true;
    state.lastCuratedAt = Date.now();
    this.recordAction(skillName, 'archive', '技能已归档');
    this.persistToDB(skillName);
  }

  /**
   * 取消归档
   * @param skillName 技能名称
   */
  unarchive(skillName: string): void {
    const state = this.getOrCreateState(skillName);

    state.archived = false;
    state.lastCuratedAt = Date.now();
    this.recordAction(skillName, 'archive', '技能已取消归档');
    this.persistToDB(skillName);
  }

  /**
   * 合并技能（将多个相似技能合并为一个）
   * @param targetName 合并后的目标技能名称
   * @param sourceNames 被合并的源技能名称列表
   */
  consolidate(targetName: string, sourceNames: string[]): void {
    const state = this.getOrCreateState(targetName);

    state.consolidatedAt = Date.now();
    state.lastCuratedAt = Date.now();
    this.recordAction(
      targetName,
      'consolidate',
      `合并自: ${sourceNames.join(', ')}`
    );

    for (const sourceName of sourceNames) {
      const sourceState = this.getOrCreateState(sourceName);
      sourceState.archived = true;
      sourceState.lastCuratedAt = Date.now();
      this.recordAction(sourceName, 'consolidate', `已合并到: ${targetName}`);
    }

    this.persistToDB(targetName);
    for (const sourceName of sourceNames) {
      this.persistToDB(sourceName);
    }
  }

  /**
   * 打补丁（更新技能定义但不改变核心逻辑）
   * @param skillName 技能名称
   * @param patchDetails 补丁详情
   */
  patch(skillName: string, patchDetails: string): void {
    const state = this.getOrCreateState(skillName);

    state.patchedAt = Date.now();
    state.lastCuratedAt = Date.now();
    this.recordAction(skillName, 'patch', patchDetails);
    this.persistToDB(skillName);
  }

  /**
   * 获取技能的策展状态
   * @param skillName 技能名称
   * @returns 策展状态
   */
  getState(skillName: string): SkillCurationState | null {
    return this.states.get(skillName) || null;
  }

  /**
   * 获取所有策展状态
   * @returns 策展状态映射
   */
  getAllStates(): Map<string, SkillCurationState> {
    return new Map(this.states);
  }

  /**
   * 检查技能是否已固定
   * @param skillName 技能名称
   * @returns 是否已固定
   */
  isPinned(skillName: string): boolean {
    return this.getOrCreateState(skillName).pinned;
  }

  /**
   * 检查技能是否已归档
   * @param skillName 技能名称
   * @returns 是否已归档
   */
  isArchived(skillName: string): boolean {
    return this.getOrCreateState(skillName).archived;
  }

  /**
   * 检查是否到了策展调度时间
   * @param skillName 技能名称
   * @returns 是否应该执行策展
   */
  shouldCurate(skillName: string): boolean {
    const state = this.getOrCreateState(skillName);

    if (!state.lastCuratedAt) {
      return true;
    }

    const elapsed = Date.now() - state.lastCuratedAt;

    return elapsed >= this.config.scheduleIntervalMs;
  }

  /**
   * 获取需要策展的技能列表
   * @returns 需要策展的技能名称列表
   */
  getDueForCuration(): string[] {
    const due: string[] = [];

    for (const [name] of this.states) {
      if (this.shouldCurate(name)) {
        due.push(name);
      }
    }

    return due;
  }

  /**
   * 记录策展操作
   * @param skillName 技能名称
   * @param action 操作类型
   * @param details 详情
   */
  private recordAction(
    skillName: string,
    action: CuratorAction,
    details: string
  ): void {
    const state = this.getOrCreateState(skillName);

    state.curationHistory.push({
      action,
      timestamp: Date.now(),
      details,
    });

    if (state.curationHistory.length > this.config.maxCurationHistory) {
      state.curationHistory = state.curationHistory.slice(
        -this.config.maxCurationHistory
      );
    }
  }

  /**
   * 获取技能的操作历史
   * @param skillName 技能名称
   * @returns 操作记录列表
   */
  getHistory(skillName: string): CuratorActionRecord[] {
    const state = this.getOrCreateState(skillName);

    return [...state.curationHistory];
  }

  /**
   * 启动调度定时器
   */
  startScheduler(): void {
    if (this.scheduleTimer) {
      return;
    }

    this.scheduleTimer = setInterval(
      () => {
        const due = this.getDueForCuration();

        for (const skillName of due) {
          const state = this.getOrCreateState(skillName);

          if (this.config.autoConsolidate && !state.pinned && !state.archived) {
            state.lastCuratedAt = Date.now();
          }
        }
      },
      Math.min(this.config.scheduleIntervalMs, 3600000)
    );
  }

  /**
   * 停止调度定时器
   */
  stopScheduler(): void {
    if (this.scheduleTimer) {
      clearInterval(this.scheduleTimer);
      this.scheduleTimer = null;
    }
  }

  /**
   * 删除技能的策展状态
   * @param skillName 技能名称
   */
  removeState(skillName: string): void {
    this.states.delete(skillName);

    if (this.skillDB) {
      // @ignore-catch — 异步从DB删除策展记录，fire-and-forget非关键路径
      this.skillDB.deleteCuration(skillName).catch(() => {});
    }
  }

  /**
   * 清除所有策展状态
   */
  clearAll(): void {
    this.states.clear();
  }
}

/**
 * 全局策展器实例
 */
let globalCurator: SkillCurator | null = null;

/**
 * 获取全局技能策展器
 * @param skillDB 可选的 DB 持久化实例
 * @param config 策展配置
 * @returns SkillCurator 实例
 */
export function getSkillCurator(
  skillDB?: SkillDB,
  config?: Partial<CuratorConfig>
): SkillCurator {
  if (!globalCurator) {
    globalCurator = new SkillCurator(config, skillDB);
  }

  return globalCurator;
}

/**
 * 重置全局策展器
 */
export function resetSkillCurator(): void {
  if (globalCurator) {
    globalCurator.stopScheduler();
  }

  globalCurator = null;
}
