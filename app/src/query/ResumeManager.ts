/**
 * ResumeManager — Durable Resume 管理器
 *
 * 启动时扫描 DB 中的 TAOR 检查点，
 * 检测未完成的会话并提供断点恢复能力。
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { isCheckpointLogEnabled } from '@modules/config';
// 多租户 P1（2026-10-21）：检查点存储按请求身份解析（模块级单例不得在 import 期定路径）
import {
  getRequestPrincipal,
  isLocalPrincipal,
  principalKeyOf,
} from '@modules/core/identity/requestScope.js';
import { registerScopedResource } from '@modules/core/identity/scopedResources.js';
import { EventEmitter } from 'events';
import { FileTAORCheckpointStorage } from './FileTAORCheckpointStorage.js';
import { DBTAORCheckpointStorage } from './DBTAORCheckpointStorage.js';
import {
  TAORPhase,
  type TAORCheckpoint,
  type CheckpointIntegrity,
  type TAORCheckpointStorage,
} from './types.js';
import type { TAORLoop, TAORLoopConfig } from './TAORLoop.js';

const logger = getLogger('query:resumeManager');

/**
 * Task 6（债二-预算挂起续跑，反目标①）：是否为**预算挂起**检查点。
 *
 * `scanPending` / `hasPending` 共用此单一判据：挂起检查点**不参与**启动扫描（否则重启即
 * 自动续跑 ⇒ 静默烧额度——日预算仍被锁）。改由 `BudgetSuspendCoordinator` 登记为"待放行"，
 * 仅用户放行（relief）后唤醒。
 */
function isBudgetSuspendCheckpoint(checkpoint: TAORCheckpoint): boolean {
  return checkpoint.type === 'budget_suspend';
}

/**
 * T3-12（2026-10-13）：是否为**任一挂起标记**检查点（预算挂起 / guard 挂起）。
 *
 * `scanPending` / `hasPending` 用此**更宽**判据排除 —— guard 挂起（熵门禁 / 轮上限）同样**不得**
 * 参与启动自动续跑（否则重启即静默续跑，违反"挂起=待人工继续"语义）。
 * 注意：`scanBudgetSuspends` 仍只筛 `budget_suspend` ⇒ guard 挂起**不**在启动期被协调器恢复
 * （guard 挂起为进程内语义；重启后需重新触发，见 T3-12 遗留说明）。
 */
function isSuspendCheckpoint(checkpoint: TAORCheckpoint): boolean {
  return (
    checkpoint.type === 'budget_suspend' || checkpoint.type === 'guard_suspend'
  );
}

/** 恢复候选 */
export interface ResumeCandidate {
  sessionId: string;
  checkpoint: TAORCheckpoint;
  savedAt: number;
  stopType: string; // 'auto' | 'manual' | 'before_abort'
  age: number; // 检查点创建至今的毫秒数
}

/** 恢复进度事件 */
export interface ResumeProgressEvent {
  phase: 'scanning' | 'validating' | 'restoring' | 'injecting' | 'ready';
  sessionId?: string;
  progress?: number;
  detail?: string;
}

export class ResumeManager {
  /** 调用方注入的存储：恒用它，不按身份解析、也不托管其生命周期 */
  private readonly injectedStorage: TAORCheckpointStorage | null;
  /** 缺省存储按归属键缓存（本地身份 = `local:local`，与其他按身份缓存同键口径） */
  private readonly scopedStorages = new Map<string, TAORCheckpointStorage>();
  private emitter: EventEmitter;

  constructor(storage?: TAORCheckpointStorage) {
    this.injectedStorage = storage ?? null;
    this.emitter = new EventEmitter();
  }

  /**
   * 当前请求身份对应的检查点存储（多租户 P1）。
   *
   * 为什么不能在构造期建一个：`resumeManager` 是**模块级单例**（import 期构造），那时没有
   * 请求作用域 ⇒ 缺省路径恒为宿主 `app.db`；租户请求（会话删除 `clearSession` / 预算挂起
   * 扫描 `scanBudgetSuspends`）会读写宿主库，而该租户分区里的检查点无人清理。
   * 改为按 `principalKeyOf` 惰性建实例后，每个身份拿到自己分区上的库（本地身份零变更）。
   *
   * 非本地身份的实例登记进 `scopedResources`：删租户时**关连接 + 摘除本表条目**。
   * 只关不摘会让下次访问拿到"路径指向已删目录"的旧实例。
   */
  private get storage(): TAORCheckpointStorage {
    if (this.injectedStorage) return this.injectedStorage;

    const principal = getRequestPrincipal();
    const key = principalKeyOf(principal);
    const cached = this.scopedStorages.get(key);
    if (cached) return cached;

    const storage = new DBTAORCheckpointStorage();
    this.scopedStorages.set(key, storage);
    if (!isLocalPrincipal(principal)) {
      registerScopedResource(key, () => {
        this.scopedStorages.delete(key);
        void storage.close?.();
      });
    }
    return storage;
  }

  /**
   * 订阅恢复进度事件（用于前端显示进度）
   */
  onProgress(listener: (event: ResumeProgressEvent) => void): () => void {
    this.emitter.on('progress', listener);
    return () => this.emitter.off('progress', listener);
  }

  /** 发射进度事件（也可被外部如 ChatManager 调用） */
  emitProgress(event: ResumeProgressEvent): void {
    this.emitter.emit('progress', event);
  }

  /** 扫描所有待恢复的会话 */
  async scanPending(): Promise<ResumeCandidate[]> {
    try {
      this.emitProgress({ phase: 'scanning', detail: '正在扫描断点检查点...' });
      const sessionIds = await this.storage.getPendingSessions();
      if (sessionIds.length === 0) {
        this.emitProgress({ phase: 'ready', detail: '无待恢复会话' });
        return [];
      }

      if (isCheckpointLogEnabled()) {
        logger.info('[ResumeManager] 扫描到待恢复会话', {
          count: sessionIds.length,
          sessionIds: sessionIds.slice(0, 10), // 最多展示 10 个
        });
      }

      const now = Date.now();
      const candidates: ResumeCandidate[] = [];

      for (const sessionId of sessionIds) {
        const latest = await this.storage.getLatestIncomplete(sessionId);
        if (!latest) {
          if (isCheckpointLogEnabled()) {
            logger.info('[ResumeManager] 会话无最新检查点，跳过', {
              sessionId,
            });
          }
          continue;
        }

        // A 阶段一 C（2026-09-05）：goal 检查点（PDL 快路径目标运行产物）不做 Durable
        // Resume——goal 会话恢复语义 = 重启后人工经 /goal 恢复；chat 侧自动恢复只服务
        // 普通对话检查点（TAORCheckpoint.kind 缺省按 chat 宽容读）。
        if (latest.kind === 'goal') {
          if (isCheckpointLogEnabled()) {
            logger.info(
              '[ResumeManager] goal 检查点跳过（非 Durable Resume 范畴，走 /goal 恢复）',
              { sessionId, checkpointId: latest.id }
            );
          }
          continue;
        }

        // Task 6（反目标①）+ T3-12：挂起标记检查点（budget_suspend / guard_suspend）跳过启动扫描
        // —— 否则重启即自动续跑（静默烧额度 / 违反"待人工继续"）。改由协调器登记为"待唤醒"。
        if (isSuspendCheckpoint(latest)) {
          if (isCheckpointLogEnabled()) {
            logger.info(
              '[ResumeManager] 挂起标记检查点跳过（待用户放行/继续，不自动续跑）',
              { sessionId, checkpointId: latest.id, type: latest.type }
            );
          }
          continue;
        }

        const age = now - latest.createdAt;
        const isExpired = age > 24 * 60 * 60 * 1000;

        // 2026-10-15（「幽灵恢复」修复）：`phase === 'completed'` 的检查点**不做 Durable Resume**。
        //
        // 根因（真机实证）：`before_abort` 检查点由 `TAORLoop.abort()` 在**用户中止前**保存，
        // 其 `phase` 记录中止时刻的循环阶段。当 phase 已是 `completed`（该轮正常跑完、仅用户
        // 主动停止），并无「未完成的推理」需要续跑；而本扫描的判据当时只有 goal/suspend/过期
        // ⇒ 这类检查点在 **24h 内每次启动都被恢复一次**（真机会话 `diag-budget-gate-2`
        // 于 10:02→11:17 被恢复 8 次，随进程反复启动复发），每次注入 steering 并建 TAORLoop
        // ⇒ 会话轮次/消息被反复累加（前端反馈的「工具轮次」异常）。
        //
        // 语义依据：用户刚点「停止」，重启即自动续跑**违背用户意图**；真正"跑到一半中断"的
        // 检查点，其 phase 不会落在 `completed`（仍可正常续跑，能力不减）。
        if (latest.phase === 'completed') {
          if (isCheckpointLogEnabled()) {
            logger.info(
              '[ResumeManager] 已完成检查点跳过（轮次已收尾，无待续推理；防幽灵恢复）',
              { sessionId, checkpointId: latest.id, type: latest.type }
            );
          }
          continue;
        }

        if (isCheckpointLogEnabled()) {
          logger.info('[ResumeManager] 检查点状态', {
            sessionId,
            checkpointId: latest.id,
            phase: latest.phase,
            type: latest.type,
            age,
            ageHours: Math.round(age / 3600000),
            isExpired,
          });
        }

        // 超过 24 小时的检查点视为过期
        if (isExpired) {
          if (isCheckpointLogEnabled()) {
            logger.info('[ResumeManager] 检查点已过期，忽略', {
              sessionId,
              checkpointId: latest.id,
              ageHours: Math.round(age / 3600000),
            });
          }
          continue;
        }

        candidates.push({
          sessionId,
          checkpoint: latest,
          savedAt: latest.createdAt,
          stopType: latest.type,
          age,
        });
      }

      if (isCheckpointLogEnabled()) {
        logger.info('[ResumeManager] 扫描完成', {
          totalPending: sessionIds.length,
          validCandidates: candidates.length,
          expired: sessionIds.length - candidates.length,
        });
      }

      return candidates.sort((a, b) => b.savedAt - a.savedAt);
    } catch (e) {
      await handleError(e, {
        module: 'query:resume',
        action: '扫描待恢复检查点',
      });
      return [];
    }
  }

  /**
   * I2（最终整支评审）：筛出 `type='budget_suspend'` 的**挂起**检查点。
   *
   * 与 `scanPending` 互为补集：`scanPending` **排除**挂起（反目标①：不自动续跑），本方法
   * **只筛出**它们供启动期交 `BudgetSuspendCoordinator` **登记为"待放行"**（spec §4.4）——
   * 修复前只做了排除 ⇒ 重启后挂起不可见也不可唤醒（`list()` 为空）。**本方法绝不触发续跑**。
   */
  async scanBudgetSuspends(): Promise<TAORCheckpoint[]> {
    try {
      const sessionIds = await this.storage.getPendingSessions();
      const suspended: TAORCheckpoint[] = [];
      for (const sessionId of sessionIds) {
        const latest = await this.storage.getLatestIncomplete(sessionId);
        if (latest && isBudgetSuspendCheckpoint(latest)) {
          suspended.push(latest);
        }
      }
      return suspended;
    } catch (e) {
      await handleError(e, {
        module: 'query:resume',
        action: '扫描预算挂起检查点',
      });
      return [];
    }
  }

  /** 检查特定 session 是否有待恢复的检查点 */
  async hasPending(sessionId: string): Promise<boolean> {
    const latest = await this.storage.getLatestIncomplete(sessionId);
    if (!latest) return false;
    // Task 6（反目标①）+ T3-12：挂起标记检查点（budget_suspend / guard_suspend）不算"待恢复"
    // （待用户放行/继续，不自动续跑）
    if (isSuspendCheckpoint(latest)) return false;
    // 过期检查
    const age = Date.now() - latest.createdAt;
    const isExpired = age > 24 * 60 * 60 * 1000;
    if (isCheckpointLogEnabled()) {
      logger.info('[ResumeManager] hasPending 检查', {
        sessionId,
        checkpointId: latest.id,
        phase: latest.phase,
        ageHours: Math.round(age / 3600000),
        isExpired,
        result: !isExpired,
      });
    }
    if (isExpired) return false;
    return true;
  }

  /** 获取会话的最新检查点 */
  async getLatestCheckpoint(sessionId: string): Promise<TAORCheckpoint | null> {
    return this.storage.getLatestIncomplete(sessionId);
  }

  /** 删除会话的所有检查点 */
  async clearSession(sessionId: string): Promise<number> {
    return this.storage.deleteSession(sessionId);
  }

  /**
   * 验证检查点完整性
   *
   * @param checkpoint 持久化的检查点
   * @param liveMessageCount 当前会话的实际消息数
   * @param liveTokenConsumed 当前 Token 预算的实际消耗
   * @returns 完整性校验结果
   */
  validateCheckpointIntegrity(
    checkpoint: TAORCheckpoint,
    liveMessageCount: number,
    liveTokenConsumed: number
  ): CheckpointIntegrity {
    return {
      phase: checkpoint.phase,
      pendingToolCalls: checkpoint.pendingToolCalls?.length ?? 0,
      tokenConsistency:
        checkpoint.budgetState.totalTokensUsed <= liveTokenConsumed,
      messageCountMatch:
        checkpoint.messageCount === undefined ||
        checkpoint.messageCount === liveMessageCount,
    };
  }

  /**
   * 获取恢复策略建议（基于完整性和阶段）
   */
  getRestoreStrategy(integrity: CheckpointIntegrity): {
    skipToolExecution: boolean;
    reExecuteTools: boolean;
    reason: string;
  } {
    let strategy: {
      skipToolExecution: boolean;
      reExecuteTools: boolean;
      reason: string;
    };
    switch (integrity.phase) {
      case TAORPhase.ACT:
        strategy = {
          skipToolExecution: false,
          reExecuteTools: integrity.pendingToolCalls > 0,
          reason: `ACT 阶段中断，${integrity.pendingToolCalls} 个工具需重新执行`,
        };
        break;
      case TAORPhase.OBSERVE:
        strategy = {
          skipToolExecution: true,
          reExecuteTools: false,
          reason: 'OBSERVE 阶段中断，工具已执行完，跳过进入 THINK',
        };
        break;
      case TAORPhase.THINK:
      default:
        strategy = {
          skipToolExecution: false,
          reExecuteTools: false,
          reason: 'THINK 阶段中断，正常恢复',
        };
        break;
    }
    if (isCheckpointLogEnabled()) {
      logger.info('[ResumeManager] 恢复策略', {
        phase: integrity.phase,
        pendingToolCalls: integrity.pendingToolCalls,
        tokenConsistency: integrity.tokenConsistency,
        messageCountMatch: integrity.messageCountMatch,
        ...strategy,
      });
    }
    return strategy;
  }
}

/** 全局单例 */
export const resumeManager = new ResumeManager();
