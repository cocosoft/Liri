/**
 * lro/taskMessaging.ts — PDCA 任务消息回写 / 事件广播 / 工具上下文构造
 *
 * 由 `tasks/LongRunningTaskOrchestrator.ts` 外迁（大文件拆分，见
 * `.trae/specs/file-size-debt-partition-plan.md` §44）：**只搬不改**（含全部原注释与
 * 日志文案）。原为 3 个宿主私有方法；全部依赖以**显式参数**传入（比类内 `this` 更清晰）
 * ⇒ 宿主行为逐字不变。logger 沿用 `tasks:longRunning` 模块名 ⇒ 日志输出不变。
 */

import { getLogger } from '@modules/monitoring';
import { globalToolManager } from '../../tools/index.js';
import type { ToolUseContext } from '../../tools/types/Tool.js';
import type { TaskMessage } from './contracts.js';

const logger = getLogger('tasks:longRunning');

/**
 * 广播任务事件（动态 import 避免启动期循环依赖；广播失败不影响任务执行）
 */
export async function emitTaskEvent(
  taskId: string,
  event: 'task:progress' | 'task:completed' | 'task:error',
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const { broadcastEvent } = await import('@modules/infrastructure');
    await broadcastEvent(event, { taskId, ...payload });
  } catch (e) {
    // @ignore-catch — 事件广播失败不影响任务执行
    logger.debug('任务事件广播失败', {
      taskId,
      event,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * RC-C 修复：为长程任务内工具执行创建最小 ToolUseContext。
 * 复用对话侧 ToolExecutor 真实执行，豁免审批（任务启动即用户授权）。
 */
export function createToolContext(params: {
  abortController: AbortController;
  sessionId: string | null;
  workspace: string;
}): ToolUseContext {
  return {
    abortController: params.abortController,
    sessionId: params.sessionId ?? undefined,
    options: {
      commands: [],
      debug: false,
      mainLoopModel: '',
      tools: globalToolManager.getAllTools(),
      verbose: false,
      thinkingConfig: {},
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: true,
      agentDefinitions: {},
      cwd: params.workspace,
    },
    readFileState: {},
    getAppState: () => ({}),
    setAppState: () => {},
    setInProgressToolUseIDs: () => {},
    setResponseLength: (f) => f(0),
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    messages: [],
  };
}

/**
 * §5 P1: 将任务消息回写到对话会话（注入的回调不存在或回写失败不阻断任务）
 */
export function emitTaskMessage(params: {
  taskId: string;
  sessionId: string | null;
  onTaskMessage?: (sessionId: string, msgs: TaskMessage[]) => void;
  msgs: TaskMessage[];
}): void {
  const { taskId, sessionId, onTaskMessage, msgs } = params;
  if (!sessionId || !onTaskMessage) {
    logger.debug(
      '[orchestrator] _emitTaskMessage 跳过（无 sessionId 或回调）',
      {
        taskId,
        hasSessionId: !!sessionId,
        hasCallback: !!onTaskMessage,
        msgCount: msgs.length,
      }
    );
    return;
  }
  try {
    logger.info('[orchestrator] _emitTaskMessage 回写消息', {
      taskId,
      sessionId,
      msgCount: msgs.length,
      roles: msgs.map((m) => m.role),
      contentPreviews: msgs.map((m) => m.content.slice(0, 60)),
    });
    onTaskMessage(sessionId, msgs);
  } catch (e) {
    logger.warn('任务消息回写失败（不影响任务执行）', {
      taskId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  // §5 P2: 顺带广播进度事件（fire-and-forget，限频由调用方控制：step 级）
  const last = msgs[msgs.length - 1];
  if (last) {
    void emitTaskEvent(taskId, 'task:progress', {
      sessionId,
      status: 'running',
      stepDesc: last.content.slice(0, 120),
    });
  }
}
