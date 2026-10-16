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
import {
  recordToolSchemaEntropy,
  readToolVisibilityOverrides,
} from '@modules/tools';
import { emitPreparedSnapshot } from '@modules/execution';
import { guardSuspendFromEntropy } from '../../query/guardSuspend.js';
import { lastUserMessageText } from '../taskIntent.js';
import { selectToolsForTurn } from './streamMessageToolSelection.js';
import type { ChatOrchestratorHost } from './ChatOrchestrator.js';

const logger = getLogger('chat:streamFlow:toolSelection');

/** 本轮 options 的**最小结构**（仅本模块消费的字段） */
export interface ToolSelectionFlowOptions {
  model?: string;
  images?: unknown[];
  metadata?: Record<string, unknown>;
  /** T1-13（2026-10-13）：本次执行的 id（PREPARED 快照落盘所需；入口未下传 ⇒ 无快照） */
  executionId?: string;
  /** T1-13 / `✅-4` R-A（2026-10-13）：重放强制可见集（宿主于续跑分支注入；未提供 ⇒ 现状） */
  forcedVisibleTools?: string[];
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
  // TG-4 / T1-13（2026-10-13）：会话 profile 能力标签（`metadata.toolProfile`）—— 非字符串项丢弃，
  // 未声明 / 空数组 ⇒ `undefined` ⇒ 追加类别为空（零行为变更）。
  const rawProfile = sessionMeta?.toolProfile;
  const profile = Array.isArray(rawProfile)
    ? rawProfile.filter((t): t is string => typeof t === 'string')
    : undefined;
  const selection = selectToolsForTurn({
    tools: toolDefinitions,
    explicitTaskType: options?.metadata?.taskType,
    baseUrl,
    projectId: sessionMeta?.projectId
      ? String(sessionMeta.projectId)
      : undefined,
    lastUserText: lastUserMessageText(apiMessages),
    hasImages,
    profile,
    // P2（2026-10-16，方案 §3.3/§3.4）：用户可见性覆写（`settings.tools`，三态）——
    // **仅在非重放分支读**：重放工具面必须恒等于落盘快照（`✅-4`，方案 R6）；
    // 空表 / 未配置 ⇒ `applyToolVisibilityOverrides` 恒等 ⇒ 零行为变更。
    ...(options?.forcedVisibleTools === undefined
      ? { overrides: readToolVisibilityOverrides() }
      : {}),
    // T1-13 / `✅-4` R-A：重放强制集（有则短路任务/profile 裁剪 ⇒ 重放工具面 = 落盘快照）
    ...(options?.forcedVisibleTools !== undefined
      ? { forcedVisibleTools: options.forcedVisibleTools }
      : {}),
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

  // T1-13 / `✅-4`（2026-10-13）—— **PREPARED 快照 durable 落盘**（落点 P-B：首次模型请求之前）。
  // 作用：动态可见性清单的**最终快照**随会话事件落盘 ⇒ 重放（`recover`）读**落盘快照**，
  // **严禁**直读当前运行时 Profile（否则长任务运行期改 Profile ⇒ 重放工具面与历史不一致）。
  // 与四原语**遥测广播**不同：本落盘**不受** `STATE_PROJECTION_BROADCAST` 门控。
  // 入口未下传 `executionId`（部分直连路径）⇒ 无执行身份可关联 ⇒ 如实不落（不臆造，CS04）。
  if (options?.executionId) {
    emitPreparedSnapshot({
      sessionId: session.id,
      executionId: options.executionId,
      visibleTools: toolDefinitions
        .map((t) => t.function?.name ?? '')
        .filter((n) => n.length > 0),
      ...(selection.taskType !== undefined
        ? { taskType: selection.taskType }
        : {}),
    });
  }

  // S2-6（2026-10-11）：**Tool-Use Context Entropy**（§4 观测项）—— 记录本轮**最终**
  // 工具 Schema 的 token 体量与占模型上下文窗口的物理比例（纯观测，零行为变更）。
  // 判据示例：长程任务第 20 轮后仍 >30% ⇒ 可跳过争论直接上 Top-K / VFS 收口。
  const schemaTokens = estimateTokens(JSON.stringify(toolDefinitions));
  const ctxWindow = resolveContextWindow(options?.model ?? '').tokens;
  const verdict = recordToolSchemaEntropy({
    toolCount: toolDefinitions.length,
    schemaTokens,
    contextWindowTokens: ctxWindow > 0 ? ctxWindow : undefined,
    // TG-5（2026-10-12 裁断）：本轮序号（与 `streamMessageFlow` 的 turn 口径一致 =
    // `toolRoundCount + 1`）⇒ 供「长程第 20 轮后 Schema 仍 >30%」阈值**告警**（只告警不阻断）。
    turn: host.toolRoundCount + 1,
  });
  // T3-12（2026-10-13 用户裁定）：熵门禁**接通挂起** —— 命中 warn 且 `GUARD_SUSPEND` 开时，
  // 在**轮间安全点**登记一条 guard 挂起（`kind='guard'`，reason='schema_entropy'）；
  // 开关关（默认）⇒ `guardSuspendFromEntropy` 返回 false 且不登记（零行为变更，熵门禁仍只 WARN）。
  // 挂起事实源 = 既有流式自动检查点链（继续入口 `_resumeSuspendedStream` 复用之）。
  guardSuspendFromEntropy(session.id, 'stream', verdict);
}
