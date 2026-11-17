// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 文件操作**回滚追踪**（2026-11-17，T3 复杂度清理 stage 5）。
 *
 * 从 `ToolExecutionService._executeInternal` **原样搬出**「回滚：文件操作前追踪」：
 *  - 写/改类工具（file_write / file_edit）执行前，把 `{path, type:'modified', toolName}`
 *    交给会话的回滚集成（`onToolBeforeExecute`）；
 *  - 子 Agent 会话：其操作同步继承到父会话的回滚集成（父会话缺失则忽略）。
 *
 * 语义约定（与搬出前一致）：
 *  - **fire-and-forget**：函数同步返回，追踪在后台完成；失败只记日志，绝不阻断工具执行；
 *  - 计划归属（D7 三期）：带上当前运行步骤的 `planId/stepId`（无则不带）。
 */
import { getLogger } from '@openliri/infra/monitoring';
import { handleError } from '@openliri/infra/error';
import type {
  FileOperation,
  RollbackIntegration,
} from '@openliri/infra/security';
import type { ChatSession } from '@modules/session/types/session.js';
import {
  FILE_WRITE_TOOL_NAME,
  FILE_EDIT_TOOL_NAME,
} from '@openliri/infra/constants';

const logger = getLogger('chat:toolExecution');

export interface RollbackTrackerDeps {
  rollbackIntegrations: Map<string, RollbackIntegration>;
  /** 会话读取（`sessionGateway.getSession`；用于解析父会话） */
  getSession(sessionId: string): Promise<unknown>;
  /** 当前会话正在执行的计划步骤（无则 null） */
  getRunningStep(
    sessionId: string
  ): { planId: string; stepId: string } | null | undefined;
}

export interface RollbackTrackerParams {
  toolCall: { id: string; name: string; sessionId?: string };
  args: Record<string, unknown>;
  deps: RollbackTrackerDeps;
}

export function trackFileOpBeforeExecute(params: RollbackTrackerParams): void {
  const { toolCall, args, deps } = params;
  const toolName = toolCall.name;
  const sessionId = toolCall.sessionId;

  if (toolName !== FILE_WRITE_TOOL_NAME && toolName !== FILE_EDIT_TOOL_NAME) {
    return;
  }

  // D7 三期（2026-11-14）：把变更归属到"当前正在执行的计划步骤"（无则不属于任何计划）
  const runningStep = sessionId ? deps.getRunningStep(sessionId) : null;
  const filePath = args?.file_path as string | undefined;
  if (!filePath || !sessionId) return;

  const integration = deps.rollbackIntegrations.get(sessionId);
  if (integration) {
    // D7 三期（2026-11-14）：带上工具名 ⇒ 副作用流水可按「工具 → 文件变更」归属
    const op: FileOperation = {
      path: filePath,
      type: 'modified',
      toolName,
      ...(runningStep
        ? { planId: runningStep.planId, stepId: runningStep.stepId }
        : {}),
    };
    integration.onToolBeforeExecute(op).catch((err) => {
      logger.warn('回滚：文件操作前追踪失败', { error: String(err) });
      handleError(err, {
        module: 'chat:toolExecution',
        action: 'rollback:onToolBeforeExecute',
      }).catch(() => {});
    });
  }

  deps
    .getSession(sessionId)
    .then((rawSess) => {
      const sess = rawSess as ChatSession | null | undefined;
      const parentId = sess?.metadata?.parentSessionId as string | undefined;
      if (parentId) {
        const parentIntegration = deps.rollbackIntegrations.get(parentId);
        if (parentIntegration) {
          const op: FileOperation = {
            path: filePath,
            type: 'modified',
            toolName,
            ...(runningStep
              ? { planId: runningStep.planId, stepId: runningStep.stepId }
              : {}),
          };
          parentIntegration.onToolBeforeExecute(op).catch((err) => {
            logger.debug('子Agent操作继承失败', {
              error: String(err),
              parentSessionId: parentId,
            });
          });
        }
      }
    })
    .catch(() => {
      // 非关键路径
    });
}
