// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 工具执行守卫（D 批外移，2026-11-05）
 *
 * 从 `ChatManager.executeTool` 迁出的执行前守卫与逐工具记账（原 1838–1952，约 115 行）。
 * 顺序与口径**逐字保持**：
 *  ① P5-4 checkpoint 边界：不可逆操作（有副作用 ∧ 非幂等）执行前须有可用快照，
 *    `relaxed` 先补建、建失败即拒绝（fail-closed）；
 *  ② B-05 逐工具**前置记账**：`beginToolCall` 落盘失败 ⇒ 不执行该工具；
 *  ③ P2-3 工具**抛错**也结算 `failed`（附错误摘要与受控分类），随后**原样抛出**；
 *  ④ G17 返回前**可等待**结算（`endToolCall`），失败仅留痕、不升级为工具失败。
 *
 * 日志 module 仍为 `chat:manager`（与迁移前同一来源，避免告警/检索口径漂移）。
 */

import { getLogger } from '@openliri/infra/monitoring';
import type { ToolCall, ToolResult } from '@modules/session/types/tool.js';

import type { ToolExecutionService } from '../services/ToolExecutionService.js';
import { ensureCheckpointBoundary } from './checkpointBudget';

const logger = getLogger('chat:manager');

/** 执行所需的宿主端口（只读；不持有 ChatManager 引用） */
export interface ToolExecutionGuardHost {
  service: ToolExecutionService;
  currentSessionId: () => string | null;
  sessionExecutionIds: ReadonlyMap<string, string>;
  resumeCoordinator: Parameters<
    typeof ensureCheckpointBoundary
  >[0]['resumeCoordinator'];
}

/** 工具执行的进度回调（`executeTool` 的 opts 形状） */
export interface ExecuteToolOptions {
  useErrorHandler?: boolean;
  onProgress?: (progress: {
    toolUseID: string;
    data: Record<string, unknown>;
  }) => void;
}

/**
 * 执行一个工具调用（含 checkpoint 边界与逐工具记账）。
 *
 * @throws 原样抛出工具自身的执行异常（结算已尽力完成，不掩盖原始错误）
 */
export async function executeToolWithGuards(
  host: ToolExecutionGuardHost,
  toolCall: ToolCall,
  opts?: ExecuteToolOptions
): Promise<ToolResult> {
  // 更新动态依赖
  const svc = host.service;
  svc.deps.currentSessionId = host.currentSessionId() ?? '';

  // P5-4（2026-10-28）：**Checkpoint 边界** —— 不可逆操作（有副作用 ∧ 非幂等）执行前，
  // 同会话必须存在 checkpoint。默认关闭（`config.json` 的 `checkpointBoundary.enabled`），
  // 关闭时零行为变更；开启后 `relaxed` 先补建快照，建失败 ⇒ 拒绝（fail-closed）。
  const boundaryRefusal = await ensureCheckpointBoundary({
    toolName: toolCall.name,
    currentSessionId: host.currentSessionId(),
    resumeCoordinator: host.resumeCoordinator,
  });
  if (boundaryRefusal) {
    logger.warn('Checkpoint 边界拒绝执行（不可逆操作前无可用快照）', {
      sessionId: host.currentSessionId(),
      toolName: toolCall.name,
      reason: boundaryRefusal,
    });
    return {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      result: null,
      error: boundaryRefusal,
    };
  }

  // B-05（2026-10-09，第九轮审查 §十五）：**逐工具前置记账（fail-closed）**。
  // 落盘失败 ⇒ 无法证明"副作用发生前已记账" ⇒ **不执行该工具**。
  const executionId = host.sessionExecutionIds.get(
    host.currentSessionId() ?? ''
  );
  if (executionId) {
    const { getExecutionManager } = await import('@openliri/service/execution');
    type ExecId = Parameters<
      ReturnType<typeof getExecutionManager>['beginToolCall']
    >[0];
    const mgr = getExecutionManager();
    const ok = await mgr.beginToolCall(
      executionId as ExecId,
      toolCall.id,
      toolCall.name
    );
    if (!ok) {
      logger.error('工具调用记账落盘失败 ⇒ 拒绝执行该工具（fail-closed）', {
        sessionId: host.currentSessionId(),
        executionId,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
      });
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: null,
        error: `工具调用记账落盘失败 ⇒ 已拒绝执行（fail-closed，executionId=${executionId}）`,
      };
    }
    // P2-3（2026-11-04）：工具**抛错**（而非返回带 error 的结果）此前绕过结算 ⇒
    // 该行永远停在 running。这里补结算为 failed 并写错误摘要，随后**原样抛出**。
    let result: Awaited<ReturnType<typeof svc.execute>>;
    try {
      result = await svc.execute(toolCall, opts);
    } catch (error) {
      try {
        await mgr.endToolCall(
          executionId as ExecId,
          toolCall.id,
          toolCall.name,
          'failed',
          (error instanceof Error ? error.message : String(error)).slice(
            0,
            500
          ),
          // P2-3：抛异常即"工具自身执行失败"（受控词表，非解析文案）
          'tool_error'
        );
      } catch {
        // @ignore-catch — 结算失败不得掩盖原始执行异常
      }
      throw error;
    }
    // 结算（G17：可等待，保证工具返回前结算已落盘/已尝试）
    await mgr.endToolCall(
      executionId as ExecId,
      toolCall.id,
      toolCall.name,
      result.error ? 'failed' : 'completed',
      result.error ?? undefined,
      // P2-3：失败分类随失败一起落表（成功行不写分类，避免脏数据）
      result.error ? result.failureKind : undefined
    );
    return result;
  }

  return svc.execute(toolCall, opts);
}
