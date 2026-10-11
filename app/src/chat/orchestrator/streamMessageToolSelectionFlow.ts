/**
 * 工具集选择 + 工具面观测（G18，2026-10-11）—— 自 `streamMessageFlow` 的 `runStreamMessage`
 * **纯搬迁**抽出（原内联块共 63 行）。
 *
 * 覆盖原 Step 3 块：
 *  - `selectToolsForTurn` 的**任务类型优先级**（显式 metadata.taskType > 本地 LLM 端点 → `local`
 *    只读轻量集 > default 保底集）/ K4 执行意图提升 / D7·L2 带图保留 image 类 / 裁剪；
 *  - 三条观测：执行意图提升、按任务裁剪、**S2-6 Tool-Use Context Entropy**；
 *  - **原地替换** `toolDefinitions`（`length = 0` + `push(...)`，数组身份不变 ⇒ 调用方后续引用不变）。
 *
 * 抽出动因：`runStreamMessage` 触发 `lint:fn-size` 棘轮（只允许缩小）⇒ 把该内联块移出本文件。
 * 语义逐字保持（含日志文案与判据）。
 *
 * ⚠️ 日志 tag 由 `chat:streamFlow` 改为本模块 `chat:streamFlow:toolSelection`（新模块自有 tag）；
 * 日志**文案**与字段不变。
 */
import { getLogger } from '@modules/monitoring';
import { estimateTokens } from '@modules/ai';
import type { ToolDefinition } from '@modules/ai';
import { resolveContextWindow } from '@modules/context';
import { recordToolSchemaEntropy } from '@modules/tools';
import { lastUserMessageText } from '../taskIntent.js';
import { selectToolsForTurn } from './streamMessageToolSelection.js';
import type { ChatOrchestratorHost } from './ChatOrchestrator.js';

const logger = getLogger('chat:streamFlow:toolSelection');

/** 本轮 options 的**最小结构**（仅本模块消费的字段） */
export interface ToolSelectionFlowOptions {
  model?: string;
  images?: unknown[];
  metadata?: Record<string, unknown>;
}

/** 工具集选择 + 观测入参 */
export interface ToolSelectionFlowParams {
  /** 本轮工具定义（**原地替换**为裁剪结果） */
  toolDefinitions: ToolDefinition[];
  /** 会话（取 `id` 与 `metadata.projectId`） */
  session: { id: string; metadata?: Record<string, unknown> };
  /** 本轮 options（取 `model` / `images` / `metadata.taskType`） */
  options?: ToolSelectionFlowOptions;
  host: ChatOrchestratorHost;
  /** 用于"最后一条用户消息文本"（K4 执行意图判定输入） */
  apiMessages: Parameters<typeof lastUserMessageText>[0];
}

/**
 * 按任务裁剪本轮工具集并记录观测（**原地替换** `toolDefinitions`）；
 * `toolDefinitions` 为空时由调用方短路（本函数假定非空）。
 */
export function selectAndObserveToolDefinitions(
  params: ToolSelectionFlowParams
): void {
  const { toolDefinitions, session, options, host, apiMessages } = params;

  // P2-1i（2026-10-10）：本轮工具集选择（任务类型优先级 + K4 执行意图提升 + D7/L2 带图保留
  // image 类 + 裁剪）外移为 `selectToolsForTurn`（判据与既有修复动因见其头注）；
  // `logger.info` 的实际调用与 `toolDefinitions` 原地替换留在此处（"动作留下"）。
  const baseUrl = (
    host.getClientForModel(options?.model) as unknown as {
      getBaseUrl?: () => string;
    }
  )?.getBaseUrl?.();
  const sessionMeta = session.metadata;
  const hasImages = Array.isArray(options?.images) && options.images.length > 0;
  const selection = selectToolsForTurn({
    tools: toolDefinitions,
    explicitTaskType: options?.metadata?.taskType,
    baseUrl,
    projectId: sessionMeta?.projectId
      ? String(sessionMeta.projectId)
      : undefined,
    lastUserText: lastUserMessageText(apiMessages),
    hasImages,
  });
  if (selection.promotedByExecutionIntent) {
    logger.info('streamMessage:tools — 项目执行意图提升 coding 集', {
      sessionId: session.id,
      projectId: String(sessionMeta?.projectId),
      before: toolDefinitions.length,
    });
  }
  if (selection.trimmed) {
    logger.info('streamMessage:tools — 按任务裁剪工具集', {
      sessionId: session.id,
      taskType: selection.taskType ?? 'default',
      hasImages,
      before: toolDefinitions.length,
      after: selection.tools.length,
      removedNames: selection.removedNames,
    });
    toolDefinitions.length = 0;
    toolDefinitions.push(...selection.tools);
  }

  // S2-6（2026-10-11）：**Tool-Use Context Entropy**（§4 观测项）—— 记录本轮**最终**
  // 工具 Schema 的 token 体量与占模型上下文窗口的物理比例（纯观测，零行为变更）。
  // 判据示例：长程任务第 20 轮后仍 >30% ⇒ 可跳过争论直接上 Top-K / VFS 收口。
  const schemaTokens = estimateTokens(JSON.stringify(toolDefinitions));
  const ctxWindow = resolveContextWindow(options?.model ?? '').tokens;
  recordToolSchemaEntropy({
    toolCount: toolDefinitions.length,
    schemaTokens,
    contextWindowTokens: ctxWindow > 0 ? ctxWindow : undefined,
  });
}
