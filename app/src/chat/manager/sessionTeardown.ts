// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * ChatSessionTeardown —— 会话**拆除 / 级联收口**（ChatManager 拆分批 A6）
 *
 * **来源**：提取自 `ChatManager.ts` 的 C21 簇（D-01/D-03 文件规模债拆分）；
 * 方案见 `.trae/specs/file-size-debt-partition-plan.md` §9.3 / §16。
 *
 * **职责（单一：删会话/清空会话时的级联收口）**：
 *   ① `deleteSession`：委托 lifecycle 删除 + PDCA 收口 + 检查点/协商状态/事件日志缓存/
 *      轮次计数清理 + 孤儿审批项关闭
 *   ② `clearAllSessions`：批量清空前按 `moduleType` 过滤清理各会话检查点
 *   ③ 三个私有级联助手：孤儿审批项关闭 / PDCA 收口（abort 活跃 PDL + checkpoint 置 abort）/
 *      检查点清理（fire-and-forget，均不阻塞删除主流程）
 *
 * **⚠️ A6 范围收窄（2026-10-05，依据 §2「可命名职责簇」+ R06-006）**：C21 中 `createSession` /
 * `forkSession` / `switchSession` / `getCurrentSession` / `getSessions` / `saveSession` /
 * `loadSession(s)` / `getSessionMessages` / `searchMessages` / `addMessage` /
 * `getMessageService` / `getStreamService` / `getSessionGateway` / `getSessionManager`
 * **均为 1 行薄委托或平凡访问器**（真正的实现早已在 `SessionLifecycleManager`）⇒ **不迁**
 * （迁出只会制造"薄转发僵尸方法"）；本模块只收**含真实逻辑**的拆除族。
 *
 * **日志 module 名保持不变**：仍为 `chat:manager`（行为等价）。
 *
 * **注入依赖**（`ChatSessionTeardownDeps`，全 getter ⇒ 无初始化顺序陷阱）：
 * 会话生命周期/网关/检查点服务/事件日志缓存/轮次计数仍归宿主所有。
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import type { SessionGateway } from '@modules/session';
import { abortSessionPlans } from '../planAbortRegistry.js';
import { deleteNegotiationState } from '../services/NegotiationState';
import type { SessionLifecycleManager } from '../services/SessionLifecycleManager.js';
import { createCheckpointService } from '../services/SessionCheckpointService.js';

const logger = getLogger('chat:manager');

/** 本模块所需的注入依赖（跨簇共享状态仍归宿主 `ChatManager` 所有，经 getter 访问） */
export interface ChatSessionTeardownDeps {
  /** 会话生命周期管理（删除/清空的实际实现） */
  getSessionLifecycle: () => SessionLifecycleManager;
  /** 会话网关（批量清空前列举待清理会话） */
  getSessionGateway: () => SessionGateway;
  /** 检查点服务 */
  getCheckpointService: () => ReturnType<typeof createCheckpointService>;
  /** 释放某会话的事件日志缓存实例（`ChatEventLogStore.dropSession`） */
  dropEventLogSession: (sessionId: string) => void;
  /** 清理某会话的工具轮次计数 */
  clearToolRound: (sessionId: string) => void;
}

export class ChatSessionTeardown {
  constructor(private readonly deps: ChatSessionTeardownDeps) {}

  async deleteSession(sessionId: string): Promise<void> {
    const startedAt = Date.now();
    logger.info('deleteSession:开始删除会话', { sessionId });
    // BUG-3 修复：持久化删除失败不再吞错——原 try/catch 只记日志不 rethrow，
    // handleDeleteSession 仍返回 200 → 前端本地移除但磁盘残留，刷新后会话"复活"。
    // 错误上抛由 handler 返回 500，前端据此不清理本地记录。
    await this.deps.getSessionLifecycle().deleteSession(sessionId);
    logger.info('deleteSession:会话删除完成', {
      sessionId,
      elapsedMs: Date.now() - startedAt,
    });
    // 4.2-5 共同前置（2026-09-05，审计 §9.8 ①）：删会话 PDCA 收口——
    // 活跃 PDL abort + 该会话任务 checkpoint 置 abort 终态（幂等，不阻塞删除主流程）
    this.closeSessionPdca(sessionId);
    // 联动清理该会话全部检查点（不阻塞删除主流程，记录执行情况，避免残留孤儿检查点）
    void this.deleteSessionCheckpoints(sessionId);
    // 清理协商状态文件（避免残留）
    deleteNegotiationState(sessionId);
    // BUG-J 修复（2026-08-26）：清理事件日志缓存——原 deleteSession 不删
    // _eventLogCache，EventLogStorage 实例（文件句柄/seq 状态）常驻内存；
    // sessionId 复用时会继承旧 seq 计数，导致 events.tail 元数据错位
    // P2-5：缓存 key 带 hash 前缀，删除时按同 key 清理（否则残留实例在分区
    // 切换后可能串用旧分区事件日志）
    this.deps.dropEventLogSession(sessionId);
    // 设计三（2026-08-26）：清理 per-session 轮次计数
    this.deps.clearToolRound(sessionId);
    // M2-T2.2（2026-08-31）：级联关闭孤儿审批项——删除含 pending 审批的会话后
    // /v1/inbox 不再残留可答复项（对齐 openworker 五步级联的审批项关闭）
    void this.dismissSessionInboxItems(sessionId);
  }

  /** M2-T2.2：关闭会话所有待处理审批项（失败不阻塞删除主流程）*/
  private async dismissSessionInboxItems(sessionId: string): Promise<void> {
    try {
      const { inboxManager } = await import('@modules/runtime/InboxManager.js');
      const closed = await inboxManager.dismissBySession(sessionId);
      if (closed > 0) {
        logger.info('deleteSession:关闭孤儿审批项', { sessionId, closed });
      }
    } catch (e) {
      logger.warn('deleteSession:关闭孤儿审批项失败', {
        sessionId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /**
   * 4.2-5 共同前置（2026-09-05，审计 §9.8 ①）：删除会话时的 PDCA 收口——
   * ① 同步 abort 该会话活跃 PDL（abortSessionPlans，S3 键化后遍历该会话全部）；
   * ② 异步将该会话全部 PDCA 任务 checkpoint 置 abort 终态（防 in-flight 复活
   * completed、/goal list 与审计一致）。幂等；任何失败仅告警、不阻塞删除主流程。
   */
  private closeSessionPdca(sessionId: string): void {
    try {
      abortSessionPlans(sessionId);
    } catch (e) {
      logger.warn('deleteSession:abortSessionPlans 失败', {
        sessionId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    void (async () => {
      try {
        // S4（PR9，③）：会话级联中止——该会话 LRTO 任务 abort（taskId 私有
        // 实例安全；abort 会级联中止其当前步骤私有 loop）。动态 import 防顶层循环。
        const { getAllOrchestrators } =
          await import('../../tasks/LongRunningTaskOrchestrator.js');
        for (const orch of getAllOrchestrators()) {
          if (orch.getSessionId() === sessionId) {
            void orch.abort();
          }
        }
      } catch (e) {
        logger.warn('deleteSession:级联中止 orchestrator 失败', {
          sessionId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      try {
        const { listPdcaCheckpoints, writePdcaCheckpoint } =
          await import('../../tasks/PdcaWorkItemBridge.js');
        const rows = listPdcaCheckpoints().filter(
          (c) => (c as { sessionId?: unknown }).sessionId === sessionId
        );
        let closed = 0;
        for (const row of rows) {
          const taskId = row.taskId as string | undefined;
          if (!taskId) continue;
          writePdcaCheckpoint(taskId, {
            status: 'abort',
            abortedAt: new Date().toISOString(),
          });
          closed++;
        }
        if (closed > 0) {
          logger.info('deleteSession:PDCA 任务已收口为 abort', {
            sessionId,
            closed,
          });
        }
      } catch (e) {
        logger.warn('deleteSession:PDCA 任务收口失败', {
          sessionId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();
  }

  /**
   * 清理指定会话的检查点并记录执行情况（fire-and-forget，不阻塞删除主流程）
   * 耗时日志：listMs（检查点列表查询）/ cleanupMs（删除）/ totalMs（总耗时），供性能分析
   */
  private async deleteSessionCheckpoints(sessionId: string): Promise<void> {
    let count = 0;
    const startedAt = Date.now();
    try {
      const t0 = Date.now();
      const before = await this.deps
        .getCheckpointService()
        .listCheckpoints(sessionId);
      const listMs = Date.now() - t0;
      count = before.length;
      if (count === 0) {
        logger.info('deleteSession:该会话无检查点，跳过清理', {
          sessionId,
          listMs,
        });
        return;
      }
      logger.info('deleteSession:开始清理会话检查点', {
        sessionId,
        count,
        listMs,
      });
      const t1 = Date.now();
      await this.deps
        .getCheckpointService()
        .deleteSessionCheckpoints(sessionId);
      const cleanupMs = Date.now() - t1;
      logger.info('deleteSession:会话检查点清理完成', {
        sessionId,
        removed: count,
        listMs,
        cleanupMs,
        totalMs: Date.now() - startedAt,
      });
    } catch (e) {
      logger.warn('deleteSession:会话检查点清理失败', {
        sessionId,
        count,
        elapsedMs: Date.now() - startedAt,
        error: e instanceof Error ? e.message : String(e),
      });
      await handleError(e, {
        module: 'chat:manager',
        action: 'deleteSession:清理检查点失败',
      });
    }
  }

  async clearAllSessions(moduleType?: string): Promise<void> {
    const startedAt = Date.now();
    logger.info('clearAllSessions:开始批量清空会话', {
      moduleType: moduleType ?? 'all',
    });
    // 批量删除前先清理所有存储会话的检查点（失败不阻塞清空主流程；按 moduleType 过滤）
    const stored = await this.deps.getSessionGateway().listSessions();
    logger.info('clearAllSessions:发现待清理存储会话', {
      count: stored.length,
    });
    await Promise.all(
      stored
        .filter(
          (s) =>
            !moduleType ||
            (s.metadata as Record<string, unknown> | undefined)?.moduleType ===
              moduleType
        )
        .map((s) =>
          this.deps
            .getCheckpointService()
            .deleteSessionCheckpoints(s.id)
            .catch((e) =>
              handleError(e, {
                module: 'chat:manager',
                action: 'clearAllSessions:清理检查点失败',
                context: { sessionId: s.id },
              })
            )
        )
    );
    await this.deps.getSessionLifecycle().clearAllSessions(moduleType);
    logger.info('clearAllSessions:批量清空完成', {
      sessions: stored.length,
      elapsedMs: Date.now() - startedAt,
    });
  }
}
