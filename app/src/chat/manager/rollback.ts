// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * ChatRollback —— 交互解析 + 文件回滚轮次（ChatManager 拆分批 A2）
 *
 * **来源**：提取自 `ChatManager.ts` 的 C19 簇（D-01/D-03 文件规模债拆分）；
 * 方案与依赖验证见 `.trae/specs/file-size-debt-partition-plan.md` §9.3 / §11。
 *
 * **职责（单一）**：
 *   ① `resolveInteraction`：用户对「交互提问」的回答解析（先落盘强一致，再注入循环；
 *      过期兜底落盘）
 *   ② 回滚集成实例的取用/构造（含权限检查器接线）
 *   ③ 回滚轮次的开始/结束（含 Shell [FILE_OPERATION] 声明补录与子 Agent 操作继承）
 *   ④ `undoRoundsSince`：撤消指定轮次之后的文件操作
 *
 * **⚠️ 与 §9.3 计划的偏差（2026-10-05）**：C19 中的 `_buildToolRoundMessages` 与
 * `_dedupeToolResultForStub` 经依赖取证判为**流管道职责**（LLM 请求消息构建 + 大结果
 * stub 去重），非"交互/回滚" ⇒ **不并入本模块**，留待批 A5（`streamPipeline`）。
 *
 * **日志 module 名保持不变**：拆分不改变日志口径（行为等价）。
 *
 * **注入依赖**（`ChatRollbackDeps`，全 getter ⇒ 无字段初始化顺序陷阱）：
 * 跨簇共享状态（交互表 / 消息服务 / 落盘 / 回滚集成表 / 权限管理器 / 会话网关）仍归宿主所有。
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { resolveProjectRoot } from '@modules/core/paths';
import {
  RollbackIntegration,
  FileOperationTracker,
  type FileChange,
} from '@modules/security';
import type { SessionGateway } from '@modules/session';
import type { Message } from '@modules/session/types/message.js';
import type { MessageService } from '../services/MessageService.js';

const logger = getLogger('chat:manager');

/** 待处理交互条目（会话隔离；宿主与新模块共享同一 Map 实例） */
export interface PendingInteractionEntry {
  questionId: string;
  promise: Promise<string[]>;
  resolve: (answers: string[]) => void;
}

/** 本模块所需的注入依赖（跨簇共享状态仍归宿主 `ChatManager` 所有，经 getter 访问） */
export interface ChatRollbackDeps {
  /** 待处理交互表（会话隔离） */
  getPendingInteractions: () => Map<string, PendingInteractionEntry>;
  /** 消息服务（回答落盘的用户消息构造） */
  getMessageService: () => MessageService;
  /** 宿主消息落盘（`throwOnError` 强一致） */
  addAndPersistMessage: (
    sessionId: string,
    message: Message,
    options?: { throwOnError?: boolean }
  ) => Promise<void>;
  /** 回滚集成表（与宿主共享同一 Map 实例） */
  getRollbackIntegrations: () => Map<string, RollbackIntegration>;
  /** 权限管理器（可空；仅回滚集成构造时接线） */
  getPermissionManager: () => unknown;
  /** 会话网关（子 Agent 操作继承需取 `parentSessionId`） */
  getSessionGateway: () => SessionGateway;
}

export class ChatRollback {
  constructor(private readonly deps: ChatRollbackDeps) {}

  /**
   * 解析待处理的用户交互（回答）。
   *
   * @param questionId 问题 ID（必须与待处理交互的 questionId 匹配）
   * @param answers 用户选择的答案列表
   * @returns 是否成功解析
   */
  // P0-1: sessionId 可选 — 传入时按会话精确定位；不传时遍历按 questionId 匹配（兼容旧调用方）
  // 问题二-1/2（2026-08-26）：改 async——① 落盘强一致：先 await 持久化用户回答再注入
  // 循环，失败上抛（HTTP 500，前端可重试），杜绝"显示成功但刷新后回答消失"；
  // ② entry 不存在（交互超时/中止已清理）时兜底落盘，回答不丢失。
  async resolveInteraction(
    questionId: string,
    answers: string[],
    sessionId?: string
  ): Promise<boolean> {
    const pending = this.deps.getPendingInteractions();
    const entry = sessionId
      ? pending.get(sessionId)?.questionId === questionId
        ? pending.get(sessionId)
        : undefined
      : Array.from(pending.entries()).find(
          ([, e]) => e.questionId === questionId
        )?.[1];
    if (entry) {
      const sid =
        sessionId ??
        Array.from(pending.entries()).find(
          ([, e]) => e.questionId === questionId
        )?.[0];
      logger.info('解析用户交互', { sessionId: sid, questionId, answers });
      // R5 + 问题二-1：先落盘（throwOnError 强一致），成功后才注入循环；
      // 回答 metadata 记录 questionId，供前端回放时恢复已提交态
      if (sid && answers.length > 0) {
        const answerMsg = this.deps
          .getMessageService()
          .createUserMessage(answers.join('\n'), {
            sessionId: sid,
            metadata: { questionId },
          });
        await this.deps.addAndPersistMessage(sid, answerMsg, {
          throwOnError: true,
        });
      }
      entry.resolve(answers);
      if (sid) pending.delete(sid);
      return true;
    }
    // 问题二-2：交互已过期/中止（entry 已清理）→ 回答兜底落盘，不注入循环。
    // PR10（#12，B-1，2026-09-05）：实证（§10.7）确认等待超时（maxWait 600s）后
    // 晚到回答命中本分支且无自动续跑。此处升级为「落盘 + 显式标记」，使：
    //   ① 回答不丢（进入消息历史，用户后续消息自动携带）；
    //   ② 前端/审计可区分「已回答但任务已结束」与「未回答」；
    //   ③ 不复活已终态任务（与 #6 replan 语义一致）。
    // 注：等待循环超时后已无存活执行方可唤醒，「超时窗口内的自动续跑」需
    // entry 宽限保留（候选 C，§10.7）——该产品决策未定，不在本分支实现。
    if (sessionId && answers.length > 0) {
      try {
        const answerMsg = this.deps
          .getMessageService()
          .createUserMessage(answers.join('\n'), {
            sessionId,
            metadata: {
              questionId,
              answeredAfterExpiry: true,
              answeredAt: new Date().toISOString(),
            },
          });
        await this.deps.addAndPersistMessage(sessionId, answerMsg, {
          throwOnError: true,
        });
        logger.info('交互已过期：回答已兜底落盘（任务已结束，未自动续跑）', {
          sessionId,
          questionId,
        });
        return true;
      } catch (e) {
        await handleError(e, {
          module: 'chat:manager',
          action: 'resolveInteractionOrphan',
        });
        return false;
      }
    }
    logger.warn('未找到匹配的待处理交互', { questionId });
    return false;
  }

  /**
   * 获取或创建回滚集成实例
   * @param sessionId 会话 ID
   * @returns 回滚集成实例
   */
  private getRollbackIntegration(sessionId: string): RollbackIntegration {
    const integrations = this.deps.getRollbackIntegrations();
    let integration = integrations.get(sessionId);
    if (!integration) {
      integration = new RollbackIntegration(sessionId);

      // 连接撤消/重做权限控制
      // 将 undo_round / redo_round 作为虚拟工具名，复用 PermissionManager
      const permissionManager = this.deps.getPermissionManager();
      if (permissionManager) {
        const pm = permissionManager as {
          checkPermissionForTool: (
            name: string,
            args: Record<string, unknown>
          ) => Promise<{ allowed: boolean; reason?: string }>;
        };
        integration.setPermissionChecker(async (action, roundId) => {
          const result = await pm.checkPermissionForTool(
            action === 'undo' ? 'undo_round' : 'redo_round',
            { sessionId, roundId }
          );
          return { allowed: result.allowed, reason: result.reason };
        });
      }

      integrations.set(sessionId, integration);
    }
    return integration;
  }

  /**
   * 开始回滚轮次追踪
   * @param sessionId 会话 ID
   * @param roundId 轮次编号
   */
  async startRollbackRound(sessionId: string, roundId: number): Promise<void> {
    const integration = this.getRollbackIntegration(sessionId);
    const scanPaths = [resolveProjectRoot()];
    await integration.onRoundStart(sessionId, roundId, scanPaths);
  }

  /**
   * 结束回滚轮次追踪并创建快照
   * @param sessionId 会话 ID
   * @param messageSummary 用户消息摘要
   * @param assistantContent 本轮首个助手消息内容（用于解析 [FILE_OPERATION] 声明）
   */
  async endRollbackRound(
    sessionId: string,
    messageSummary: string,
    assistantContent?: string
  ): Promise<void> {
    const integration = this.deps.getRollbackIntegrations().get(sessionId);
    if (integration) {
      const snapshot = await integration.onRoundEnd(messageSummary);

      // P1: Shell 声明-校验 — 解析 AI 的 [FILE_OPERATION] 声明，补录 detectShellSideEffects 漏掉的操作
      if (snapshot && assistantContent) {
        try {
          const declarations =
            FileOperationTracker.parseFileOperationDeclarations(
              assistantContent,
              resolveProjectRoot()
            );
          if (declarations.length > 0) {
            // 将声明中未被 detectShellSideEffects 检测到的操作补充到变更列表
            const existingPaths = new Set(
              snapshot.changedFiles.map((c: { path: string }) => c.path)
            );
            const missedChanges: FileChange[] = [];

            for (const decl of declarations) {
              const absPath = decl.path;
              if (!existingPaths.has(absPath)) {
                // 声明但未检测到的文件操作
                if (decl.type === 'created') {
                  // 创建声明：文件可能已创建但不在扫描范围内
                  missedChanges.push({ path: absPath, type: 'created' });
                } else if (decl.type === 'deleted') {
                  // 删除声明：文件可能已被删除
                  missedChanges.push({ path: absPath, type: 'deleted' });
                } else if (decl.type === 'modified') {
                  missedChanges.push({ path: absPath, type: 'modified' });
                }
              }
            }

            if (missedChanges.length > 0) {
              integration.mergeChanges(missedChanges);
              logger.debug(
                'Shell声明校验：补录detectShellSideEffects漏掉的操作',
                {
                  sessionId,
                  declaredCount: declarations.length,
                  missedCount: missedChanges.length,
                }
              );
            }
          }
        } catch {
          // @ignore-catch — 非关键路径
        }
      }

      // P1: 子 Agent 操作继承 — 将子 Agent 的 Shell 副作用（file_create / file_delete）合并到父会话 tracker
      if (snapshot && snapshot.changedFiles.length > 0) {
        try {
          const session = await this.deps
            .getSessionGateway()
            .getSession(sessionId);
          const parentSessionId = session?.metadata?.parentSessionId as
            | string
            | undefined;
          if (parentSessionId) {
            const parentIntegration = this.deps
              .getRollbackIntegrations()
              .get(parentSessionId);
            if (parentIntegration) {
              // 只合并 Shell 副作用产生的 created / deleted 类型变更
              // modified 类型已通过 ChatManager 工具拦截（Write/Edit）直接转发
              const shellChanges = snapshot.changedFiles.filter(
                (c: { type: string }) =>
                  c.type === 'created' || c.type === 'deleted'
              );
              if (shellChanges.length > 0) {
                parentIntegration.mergeChanges(shellChanges);
                logger.debug('子Agent操作继承：Shell副作用已合并到父会话', {
                  childSessionId: sessionId,
                  parentSessionId,
                  changeCount: shellChanges.length,
                });
              }
            }
          }
        } catch (err) {
          // 非关键路径，继承失败不影响子 Agent 自身的回滚
          logger.debug('subAgent mergeChanges skipped', { error: String(err) });
        }
      }
    }
  }

  /**
   * 执行文件回滚 — 撤消指定轮次之后的文件操作
   * 用于 truncateMessages（回退消息）时的文件系统级联回滚
   * @param sessionId 会话 ID
   * @param sinceRoundId 从该轮次之后开始撤消
   * @param maxRound 最大轮次编号
   * @param roundIndex 消息ID→轮次ID映射（用于清理）
   * @returns 每个轮次的 undo 结果
   */
  async undoRoundsSince(
    sessionId: string,
    sinceRoundId: number,
    maxRound: number,
    roundIndex: Record<string, number>
  ): Promise<Array<{ roundId: number; success: boolean; error?: string }>> {
    const integration = this.deps.getRollbackIntegrations().get(sessionId);
    if (!integration) return [];

    const results: Array<{
      roundId: number;
      success: boolean;
      error?: string;
    }> = [];

    // 倒序撤消（从最新轮次往最早）
    for (let r = maxRound; r > sinceRoundId; r--) {
      try {
        await integration.undoRound(r);
        results.push({ roundId: r, success: true });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        results.push({ roundId: r, success: false, error: errorMsg });
        // 失败不阻塞后续回滚
      }
      // 清理 roundIndex 中对应轮次的条目
      for (const [msgId, rid] of Object.entries(roundIndex)) {
        if (rid === r) {
          delete roundIndex[msgId];
        }
      }
    }

    return results;
  }
}
