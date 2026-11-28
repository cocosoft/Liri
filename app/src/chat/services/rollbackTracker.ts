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
 * 语义约定：
 *  - **写/改类工具路径要 `await`**（2026-11-21 改）：会话集成在工具写入**前**做 pre-image 备份，
 *    这是 undo 恢复内容的唯一来源 ⇒ 不 await 会与写入竞态（备份到"改后"内容甚至读不到文件）；
 *    失败仍只记日志、**不阻断**工具执行。
 *  - 子 Agent 的父会话继承仍是**后台**（仅用于变更归属/记账，不再做第二份备份）；
 *  - 计划归属（D7 三期）：带上当前运行步骤的 `planId/stepId`（无则不带）。
 */
import { getLogger } from '@openliri/infra/monitoring';
import { handleError } from '@openliri/infra/error';
import { isAbsolute, resolve } from 'node:path';
import { getPlanRoundIntegration } from '@openliri/infra/security';
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

/**
 * 取该会话**当前应记账的**回滚集成（2026-11-28）。
 *
 * 优先级：**计划执行轮**（PDCA / 长程任务）> 聊天会话集成。
 *
 * 为什么要有计划轮这一层：PDCA 快路径的工具写入同样经由 `ToolExecutionService`，
 * 但它没有聊天工具轮 ⇒ 只有会话集成时会打「onRoundStart 之前调用，跳过追踪」而整轮丢失
 * （真机 `output/image_explanation.md` / `output/pelican_bicycle.svg`）。计划轮单独一份集成
 * 可避免与并发的聊天轮互相 `reset`（见 `packages/infra/src/security/rollback/planRound.ts`）。
 */
export function resolveRollbackIntegration(
  sessionId: string,
  deps: RollbackTrackerDeps
): RollbackIntegration | undefined {
  return (
    getPlanRoundIntegration(sessionId) ??
    deps.rollbackIntegrations.get(sessionId)
  );
}

export interface RollbackTrackerDeps {
  rollbackIntegrations: Map<string, RollbackIntegration>;
  /** 会话读取（`sessionGateway.getSession`；用于解析父会话） */
  getSession(sessionId: string): Promise<unknown>;
  /** 当前会话正在执行的计划步骤（无则 null） */
  getRunningStep(
    sessionId: string
  ): { planId: string; stepId: string } | null | undefined;
  /**
   * 相对路径的**基准目录**（与工具 `options.cwd` 同源；2026-11-28）。
   *
   * 为什么必须注入：工具（`file_write` / `file_edit`）把相对路径解析到 `options.cwd`
   * （`resolveFilePath`），而回滚录制此前直接用**原始相对路径** ⇒ pre-image 备份/undo 落在
   * 进程 cwd 而不是工具真实写入的位置（PDCA 步骤普遍写 `output/xxx.md` 这类相对路径）。
   * 未注入 ⇒ 保持旧行为（原样记录）。
   */
  getToolBaseDir?: (sessionId: string) => string | undefined;
}

/**
 * 相对路径 ⇒ 绝对路径（基准目录 = 工具 `options.cwd`）。
 *
 * 只做最小对齐：绝对路径原样返回（工具同样直接 resolve）；相对路径拼到基准目录上。
 * 不做环境变量展开（工具侧 `resolveFilePath` 会做）—— 未展开时源文件找不到 ⇒
 * 集成按"新建文件"记 `created`，与改动前行为一致，不会误备份到别处。
 */
function toAbsoluteToolPath(
  rawPath: string,
  baseDir: string | undefined
): string {
  if (!baseDir) return rawPath;
  const normalized = rawPath.replace(/\\/g, '/');
  return isAbsolute(normalized) ? rawPath : resolve(baseDir, normalized);
}

export interface RollbackTrackerParams {
  toolCall: { id: string; name: string; sessionId?: string };
  args: Record<string, unknown>;
  deps: RollbackTrackerDeps;
}

export async function trackFileOpBeforeExecute(
  params: RollbackTrackerParams
): Promise<void> {
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
  // 2026-11-28：相对路径按**工具 cwd** 解析为绝对路径 —— 工具（`resolveFilePath`）就是这样
  // 落盘的；不归一化会让 pre-image 备份/undo 指向进程 cwd（PDCA 步骤普遍写相对路径）。
  const absPath = toAbsoluteToolPath(
    filePath,
    deps.getToolBaseDir?.(sessionId)
  );

  const integration = resolveRollbackIntegration(sessionId, deps);
  if (integration) {
    // D7 三期（2026-11-14）：带上工具名 ⇒ 副作用流水可按「工具 → 文件变更」归属
    const op: FileOperation = {
      path: absPath,
      type: 'modified',
      toolName,
      ...(runningStep
        ? { planId: runningStep.planId, stepId: runningStep.stepId }
        : {}),
    };
    // 2026-11-21：此处**必须 await** —— 集成在写入前做 pre-image 备份（undo 的唯一内容来源），
    // 之前的 fire-and-forget 会让备份与工具写入竞态（甚至备份到"改后"内容）。
    // 备份失败仍只记日志、不阻断工具执行（catch 不外抛）。
    try {
      await integration.onToolBeforeExecute(op);
    } catch (err) {
      logger.warn('回滚：文件操作前追踪失败', { error: String(err) });
      handleError(err, {
        module: 'chat:toolExecution',
        action: 'rollback:onToolBeforeExecute',
      }).catch(() => {});
    }
  }

  deps
    .getSession(sessionId)
    .then((rawSess) => {
      const sess = rawSess as ChatSession | null | undefined;
      const parentId = sess?.metadata?.parentSessionId as string | undefined;
      if (parentId) {
        // 2026-11-28：父会话同样优先记到**计划轮**（父会话可能正处于 PDCA / 长程任务执行中）
        const parentIntegration = resolveRollbackIntegration(parentId, deps);
        if (parentIntegration) {
          const op: FileOperation = {
            path: absPath,
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
