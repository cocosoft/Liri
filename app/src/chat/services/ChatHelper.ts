// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 聊天辅助工具类
 * 从 ChatManager 拆分出的纯函数和轻量依赖方法，不依赖 ChatManager 的 this 上下文
 */
import { getLogger } from '@modules/monitoring';
import type { SessionConfirmedPaths } from './SessionConfirmedPaths';
import type { Message, UsageInfo } from '@modules/session/types/message.js';
import { MessageRole } from '@modules/session/types/message.js';
import {
  DataSessionStatus,
  LOCAL_HTTP_HOST,
  LOCAL_SERVICE_HOST,
  WILDCARD_BIND_HOST,
} from '@openliri/kernel';
import type { ChatSession } from '@modules/session/types/session.js';
import type { ToolResult } from '@modules/session/types/tool.js';
import type { TodoBlockData } from '@modules/runtime/api/todo-types.js';
import { MessageType as SessionMessageType } from '@modules/session/types/UnifiedMessage';
import { MessageRole as SessionMessageRole } from '@modules/session/types/UnifiedMessage';
import type {
  UnifiedMessage,
  FrontendMessageBlock,
  MessageMetadata,
} from '@modules/session/types/UnifiedMessage';
import type { SessionGateway } from '@modules/session';
import { SessionStateMachine } from '../../state/session/SessionStateMachine.js';
import { getAIModelManager } from '@modules/ai';
import { TOOL_RESULT_MAX_LENGTH } from '@modules/utils/toolResultLimits';
// BUG-C 第二轮复验（2026-10-27）：HTTP 未指定模型时填的是占位哨兵，预算归一须排除
import { DEFAULT_MODEL_SENTINEL } from '../../constants/common.js';

const logger = getLogger('chat:helper');

/**
 * 工具结果默认最大字符数（Bug Fix: 从 2000 提升至 8000，防止截断丢失关键上下文导致 LLM 误判任务完成）
 *
 * 2026-10-02（戊 / D-234）：**定义已移至** `utils/toolResultLimits`（单一事实源，见该文件头注）；
 * 此处保留再导出以免波及既有调用方。
 */
export { TOOL_RESULT_MAX_LENGTH };

/**
 * 判断是否为"空正文且无 tool_calls"的 assistant 消息。
 * 工具循环中模型只回 tool_calls 但未解析/落盘、或空响应产生的中间消息，
 * 进入 API 上下文会污染模型（多轮空 assistant 消息）并浪费 token，
 * 构建 API 消息列表时应跳过（_buildApiMessagesForStream / prepareApiMessages 共用）。
 */
export function isEmptyAssistantWithoutToolCalls(msg: Message): boolean {
  if (msg.role !== MessageRole.ASSISTANT) return false;
  if (typeof msg.content !== 'string' || msg.content.trim() !== '')
    return false;
  const metaToolCalls = msg.metadata?.tool_calls as unknown;
  const hasMetaToolCalls =
    Array.isArray(metaToolCalls) && metaToolCalls.length > 0;
  const hasMsgToolCalls =
    Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
  return !hasMetaToolCalls && !hasMsgToolCalls;
}

/**
 * AB-10 修复：Provider 原始 usage（prompt_tokens 等）→ 标准 UsageInfo。
 * 流式主回复（StreamPipeline）与工具轮次（streamMessageFlow onToolUsage）共用，
 * 保证 usage SSE 事件的字段口径一致。
 */
export function toUsageInfo(
  usage: Record<string, unknown>
): UsageInfo | undefined {
  const u = usage as Record<string, number>;
  const inputTokens = u.prompt_tokens ?? u.inputTokens ?? 0;
  const outputTokens = u.completion_tokens ?? u.outputTokens ?? 0;
  if (inputTokens === 0 && outputTokens === 0) return undefined;
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
    estimatedCostUsd: u.estimated_cost_usd ?? u.estimatedCostUsd,
  };
}

/**
 * 将 Message 角色映射为 SessionMessageType
 */
export function toSessionMsgType(message: Message): SessionMessageType {
  if (message.role === MessageRole.USER) return SessionMessageType.USER;
  if (message.role === MessageRole.ASSISTANT)
    return SessionMessageType.ASSISTANT;
  if (message.role === MessageRole.TOOL) return SessionMessageType.TOOL_RESULT;
  return SessionMessageType.SYSTEM;
}

/**
 * 单轮清理：从后往前遍历，移除 tool_calls 未得到完整响应的 assistant 消息
 */
export function sanitizePass(apiMessages: Record<string, unknown>[]): void {
  for (let i = apiMessages.length - 1; i >= 0; i--) {
    const msg = apiMessages[i];

    if (
      msg.role === 'assistant' &&
      Array.isArray(msg.tool_calls) &&
      (msg.tool_calls as Array<{ id?: string }>).length > 0
    ) {
      const pendingIds = new Set<string>();
      for (const tc of msg.tool_calls as Array<{ id?: string }>) {
        if (tc.id) pendingIds.add(tc.id);
      }

      if (pendingIds.size === 0) continue;

      let j = i + 1;
      while (j < apiMessages.length && apiMessages[j]?.role === 'tool') {
        const toolMsg = apiMessages[j];
        if (toolMsg.tool_call_id) {
          pendingIds.delete(toolMsg.tool_call_id as string);
        }
        j++;
      }

      if (pendingIds.size > 0) {
        // 有未响应的 tool_call_id：删除此 assistant 及紧随其后的 tool 消息
        apiMessages.splice(i, 1);
        while (i < apiMessages.length && apiMessages[i]?.role === 'tool') {
          apiMessages.splice(i, 1);
        }
      }
    }
  }
}

/**
 * 将会话状态字符串映射为统一 DataSessionStatus 枚举
 */
export function mapSessionStatusToState(status: string): DataSessionStatus {
  switch (status) {
    case 'active':
    case 'running':
      return DataSessionStatus.ACTIVE;
    case 'paused':
      return DataSessionStatus.PAUSED;
    case 'ended':
    case 'completed':
    case 'aborted':
      return DataSessionStatus.ENDED;
    case 'archived':
      return DataSessionStatus.ARCHIVED;
    default:
      return DataSessionStatus.ACTIVE;
  }
}

/**
 * 从工具执行结果中提取 TodoBlockData
 */
export function extractTodoData(toolResult: ToolResult): TodoBlockData | null {
  const result = toolResult as unknown as {
    metadata?: Record<string, unknown>;
  };
  const metadata = result.metadata;
  if (!metadata?._todoData) return null;

  const raw = metadata._todoData as Record<string, unknown>;

  if (Array.isArray(raw.tasks)) {
    return {
      title: (raw.title as string) || '任务计划',
      tasks: raw.tasks as TodoBlockData['tasks'],
      phase: (raw.phase as TodoBlockData['phase']) || 'planning',
      createdAt: Date.now(),
      // P2-1 修复（2026-09-26）：透传 planId。
      // 生产方 `TodoWriteTool._buildTodoData()` 一直带它（TodoWriteTool.ts:646-660，注释
      // 明写"供前端按 planId 查重区分多计划"），下游也一直**条件**消费它：
      //   · ReActToolLoop.ts:805 的扩容键 `todoData.planId ?? todoData.title`
      //   · streamMessageFlow.ts:2332 / :2418 与 ChatManagerTAORAdapter.ts:501 的 taskCard.planId
      // 唯独此处把它丢了 ⇒ 下游三处的 planId 分支**恒不可达**（键实际恒为 title、
      // taskCard.planId 永不出现）。类型早已具备（todo-types.ts:53）。
      // ⚠️ 必须**条件展开**（不可写 `planId: raw.planId`）：`undefined` 会成为显式键，
      // 而计划事件的载荷校验会据此判 `invalid-event`（见 streamMessageFlow.ts:2331 的注释）。
      ...(typeof raw.planId === 'string' && raw.planId
        ? { planId: raw.planId }
        : {}),
    };
  }
  return null;
}

import { ImageUrlHelper } from '@modules/tools';

/**
 * 修复 AI 响应中错误的图片 URL
 *
 * 委托给 ImageUrlHelper.repairAll，统一处理：
 * - Markdown 图片语法 ![alt](错误路径)
 * - 磁盘绝对路径 E:\...\filename.png
 * - 各种错误 URL 格式
 */
export function repairImageUrls(content: string): string {
  return ImageUrlHelper.repairAll(content);
}
export function resolveMaxContextTokens(model?: string): number {
  if (model) {
    try {
      const { resolveContextWindow } = require('@modules/context');
      const ctx = resolveContextWindow(model);
      if (ctx.tokens > 0) return ctx.tokens;
    } catch (ctxErr) {
      // KB-CTXWINDOW-LOG（2026-08-29）：ContextWindowResolver 解析失败 → 回退，但需记录
      logger.warn(
        '上下文窗口解析失败（ContextWindowResolver），回退 AIModelManager',
        {
          model,
          error: ctxErr instanceof Error ? ctxErr.message : String(ctxErr),
        }
      );
    }
    try {
      const ctx = getAIModelManager().getContextWindow(model);
      if (ctx > 0) return ctx;
    } catch (mgrErr) {
      // KB-CTXWINDOW-LOG2（2026-08-29）：AIModelManager 也失败 → 默认 128k 无任何痕迹
      logger.warn('上下文窗口解析失败（AIModelManager），使用默认 128k', {
        model,
        error: mgrErr instanceof Error ? mgrErr.message : String(mgrErr),
      });
    }
  }
  return 128_000;
}

/**
 * BUG-C（2026-10-27 真机长程任务）：解析本轮**输出预算**——唯一事实源是 DB 的
 * `model_registry.max_output_tokens`（经 `ModelRegistry` 内存缓存读取）。
 *
 * ## 为什么需要它
 *
 * 此前聊天链（`streamMessageFlow` / `streamingLlm`）在调用方未显式给 `maxTokens` 时
 * **硬编码 4096**：实测长程任务 4 次 LLM 调用 `outputTokens` 全部恰好 4096（整点值），
 * 写大文件被截断 ⇒ 无从收尾（与 `EMPTY-TOOL-TURN` 同一症状面）。
 *
 * 口径（与 `resolveMaxContextTokens` 同源，且遵守「模型属性读 DB」）：
 *   1. 查不到模型 / 注册表未就绪 ⇒ `undefined`（**不臆造**，调用方保留原兜底）；
 *   2. 查到则用 DB 值（用户可在模型管理里改）；
 *   3. 结果**封顶**为该模型窗口的一半，避免"输出预算 > 窗口"导致 400。
 */
export function resolveMaxOutputTokens(model?: string): number | undefined {
  const name = model?.trim();
  if (!name) return undefined;
  try {
    const { ModelRegistry } = require('@modules/ai/models/ModelRegistry');
    const cfg = (
      ModelRegistry.getInstance() as {
        getModel?: (
          id: string
        ) => { maxOutputTokens?: number; contextWindow?: number } | undefined;
      }
    ).getModel?.(name);
    const out = cfg?.maxOutputTokens;
    if (typeof out !== 'number' || out <= 0) return undefined;
    // 封顶用**同一 DB 记录**的窗口（不与 `resolveMaxContextTokens` 的回落值混源：
    // 后者在注册表未预热时会回落 200k/128k，会让封顶失效）。
    const window = cfg?.contextWindow;
    return typeof window === 'number' && window > 0
      ? Math.min(out, Math.floor(window / 2))
      : out;
  } catch (e) {
    // @ignore-catch — 注册表读取失败不影响发送（回落到调用方原兜底）
    logger.warn('输出预算解析失败（ModelRegistry），回落调用方兜底', {
      model: name,
      error: e instanceof Error ? e.message : String(e),
    });
    return undefined;
  }
}

/**
 * BUG-C（2026-10-27 真机长程任务）：给一轮请求**补齐输出预算**（返回副本，不改入参）。
 *
 * - 调用方显式给了 `maxTokens` ⇒ 原样保留（用户/上层优先）；
 * - 否则取 DB 的 `model_registry.max_output_tokens`（见 `resolveMaxOutputTokens`）；
 * - 模型名缺失时先用 `resolveEffectiveTurnModel` 解析（自发轮次不带 `options.model`），
 *   并把解析结果回填到副本的 `model`，让工具轮沿用同一模型名解析预算。
 * - 都取不到 ⇒ 保持原样（不臆造，下游保留既有 4096 兜底）。
 *
 * 位置选择：放在发送链路**入口**（`ChatOrchestrator` 调 `runStreamMessage` 之前）一次性
 * 归一，使 `streamMessageFlow` / `streamingLlm` / 发送前保护读到同一值，且不必在
 * 已锁棘轮的超大函数里再长出分支。
 */
export async function withTurnBudget<
  T extends { maxTokens?: number; model?: string; sessionId?: string },
>(options: T | undefined, client?: BudgetClientLike): Promise<T | undefined> {
  if (!options || options.maxTokens) return options;
  // BUG-C 第二轮复验（2026-10-27 14:07Z）：HTTP 请求的 `model` 可能是**占位哨兵**
  // `pyapp-default`（未显式指定模型时由 handler 填入）——它查不到 DB 记录，会让预算
  // 归一直接失效（实测非流式 + TAOR 路径 outputTokens 仍恒为 4096）。哨兵视为"未指定"。
  const explicit =
    options.model && options.model !== DEFAULT_MODEL_SENTINEL
      ? options.model
      : undefined;
  const model = await resolveEffectiveTurnModel({
    explicitModel: explicit,
    client,
    sessionId: options?.sessionId,
  });
  const maxTokens = resolveMaxOutputTokens(model);
  if (maxTokens === undefined) return options;
  return {
    ...options,
    // 不覆盖调用方显式给的模型名（哨兵也不覆盖——下游按哨兵做默认路由）
    ...(maxTokens !== undefined ? { maxTokens } : {}),
  } as T;
}

/** `withTurnBudget` 的客户端接缝（只读 provider 级默认模型名） */
export interface BudgetClientLike {
  getConfiguredModel?: () => string | undefined;
}

/**
 * 解析"本轮**实际会使用**的模型"（发送前使用：窗口 / 压缩阈值 / 预估价归因）。
 *
 * ## 为什么需要它（2026-09-27，服务端自发轮次的模型归属）
 *
 * 自发轮次（系统续跑 / 自唤醒 / 目标空闲续接 / PDCA）经
 * `ChatManager._resumeSessionInternally → streamMessage(content, { sessionId, metadata })`
 * —— **不带 `options.model`**。发送前的决策点因此只拿到空模型
 * ⇒ `resolveMaxContextTokens('')` 回落**硬编码 `128_000`**（见上），与真实模型窗口不符：
 *   - 真实窗口更大（如 200k/1M）⇒ **过度压缩 / 过度截断**（丢上下文、白跑压缩）；
 *   - 真实窗口更小（如 32k）⇒ 保护不足（可能 400 context 超限）。
 *
 * ## 取值链（与请求侧同源，且**零额外模型调用**）
 *
 *   1. `explicitModel`（调用方显式指定；命中即用）；
 *   2. **provider 级默认模型**（`config.model` / 构造 `defaultModel`，纯读）；
 *   3. `resolveModelRoute(CHAT, { sessionId, skipJudge: true })`
 *      ——「用户显式任务分工 → 会话黏性 → 默认档位」，**不进 LLM Judge**：
 *      为"读一个模型名"触发一次模型调用（Judge）不可接受，且 Judge 结果只影响档位。
 *
 * ⚠️ 本函数**只读**：返回值**仅用于**窗口 / 压缩 / 估价等**估算与归因**，
 * **不得**用于决定实际请求走哪个模型（那由 provider 侧完整链决定；
 * 模型选择遵循用户显式选择，不得擅自变更）。无法解析时返回 `undefined`
 * ⇒ 调用方保持旧行为（不伪造模型名）。
 */
export async function resolveEffectiveTurnModel(params: {
  explicitModel?: string;
  /** 当前客户端（读 provider 级默认模型；缺省则跳过第 2 步） */
  client?: { getConfiguredModel?: () => string | undefined };
  sessionId?: string;
}): Promise<string | undefined> {
  const explicit = params.explicitModel?.trim();
  if (explicit) return explicit;

  const configured = params.client?.getConfiguredModel?.()?.trim();
  if (configured) return configured;

  try {
    const { resolveModelRoute, RouteKey } =
      await import('@modules/ai/router/resolveModelRoute');
    const model = await resolveModelRoute(RouteKey.CHAT, {
      ...(params.sessionId ? { sessionId: params.sessionId } : {}),
      skipJudge: true,
    });
    return model?.trim() || undefined;
  } catch (err) {
    // @ignore-catch — 解析失败不影响发送：调用方以 undefined 回落旧行为（默认窗口）
    logger.warn('resolveEffectiveTurnModel: 路由解析失败（回落旧行为）', {
      error: err instanceof Error ? err.message : String(err),
      sessionId: params.sessionId,
    });
    return undefined;
  }
}

/**
 * 工具结果载荷 → 模型可见文本（2026-09-29，与「出参对象化」同批）。
 *
 * **归一化动机**：`ChatManager._buildToolRoundMessages` 内**两处**（诊断日志 / 实际载荷）原各写
 * 一遍 `payload ? JSON.stringify(payload) : error || '{}'` —— **truthiness 判定**会把
 * `''` / `0` / `false` 一并误判为"无载荷"并替换成 `'{}'` ⇒ 模型看到 `{}` 而非真实空值。
 * 此处收敛为**单一实现**（两处共用），并只把 `undefined` / `null` 视为无载荷。
 *
 * ⚠️ **不在本项范围**：对**字符串**载荷同样 `JSON.stringify` 这一既有行为**保持不动**
 * （它是"字符串出参在模型侧被多套一层引号/转义"的来源，属框架级话题，另立项）。
 */
export function toToolResultRawText(
  payload: unknown,
  error: string | null | undefined
): string {
  if (payload === undefined || payload === null) {
    return error || '{}';
  }
  return JSON.stringify(payload);
}

/**
 * 截断工具结果，保留前后关键信息
 * 策略：前 500 字符（上下文） + 后 1500 字符（file_path 等关键信息）
 * 并在截断提示中列出工具结果中包含的文件路径，避免路径幻觉
 */
export function truncateToolResult(
  content: string,
  maxLen: number = TOOL_RESULT_MAX_LENGTH,
  confirmedPaths?: SessionConfirmedPaths
): string {
  const sizeKB = Math.round(content.length / 1024);
  if (content.length <= maxLen) return content;

  const headLen = 500;
  const tailLen = maxLen - headLen;
  const omitted = content.length - headLen - tailLen;

  // 从原始内容中提取文件路径（优先保留，减少路径幻觉）
  const filePathRegex =
    /[a-zA-Z]:\\(?:[^\\\n\r]+\\)*[^\\\n\r]*\.[a-zA-Z0-9]+|\/(?:[^/\n\r]+\/)*[^/\n\r]*\.[a-zA-Z0-9]+/g;
  const matchedPaths = content.match(filePathRegex);
  const uniquePaths = matchedPaths
    ? [...new Set(matchedPaths)].slice(0, 5).join('\n  ')
    : '';

  // 将截断保留的路径注册到 SessionConfirmedPaths（方案 4 联动）
  if (confirmedPaths && matchedPaths) {
    for (const p of new Set(matchedPaths)) {
      confirmedPaths.add(p);
    }
  }

  const header = uniquePaths
    ? `[工具结果已截断，原始大小 ${sizeKB}KB，保留首尾关键信息]\n涉及的路径:\n  ${uniquePaths}\n`
    : `[工具结果已截断，原始大小 ${sizeKB}KB，保留首尾关键信息]\n`;

  return (
    header +
    content.slice(0, headLen) +
    `\n\n... [中间省略 ${omitted} 字符] ...\n\n` +
    content.slice(content.length - tailLen)
  );
}

/**
 * 从会话缓存中获取会话
 * @param sessions 会话缓存 Map
 * @param sessionId 会话 ID
 */
export function getLocalSession(
  sessions: Map<string, ChatSession>,
  sessionId: string | null | undefined
): ChatSession | undefined {
  if (!sessionId) return undefined;
  const session = sessions.get(sessionId);
  if (!session) {
    logger.warn('缓存未命中', { sessionId });
  }
  return session;
}

/**
 * 获取或创建会话状态机
 * @param machines 状态机缓存 Map
 * @param sessionId 会话 ID
 */
export function getOrCreateSessionMachine(
  machines: Map<string, SessionStateMachine>,
  sessionId: string
): SessionStateMachine {
  let machine = machines.get(sessionId);
  if (!machine) {
    machine = new SessionStateMachine(sessionId);
    machines.set(sessionId, machine);
  }
  return machine;
}

/**
 * 将 chat Message 转换为 UnifiedMessage 并持久化到 SessionGateway
 * @param gateway 会话持久化网关
 * @param sessionId 会话 ID
 * @param message 聊天消息
 */
export async function persistChatMessage(
  gateway: SessionGateway,
  sessionId: string,
  message: Message,
  options?: { throwOnError?: boolean }
): Promise<void> {
  const toolCalls =
    message.tool_calls ||
    (message.metadata?.tool_calls as
      | Array<Record<string, unknown>>
      | undefined);
  const metadataObj: MessageMetadata = {
    ...(message.metadata as MessageMetadata | undefined),
    ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
    ...(toolCalls ? { tool_calls: toolCalls } : {}),
  };
  const unifiedMessage: UnifiedMessage = {
    id: message.id,
    sessionId,
    type: toSessionMsgType(message),
    role: message.role as unknown as SessionMessageRole,
    content:
      typeof message.content === 'string'
        ? message.content
        : JSON.stringify(message.content),
    timestamp: message.createdAt?.getTime() ?? Date.now(),
    // 1.6：流式开始时间随消息落盘（与 timestamp 完成时间区分）
    startedAt: message.startedAt?.getTime(),
    metadata: metadataObj,
    blocks: message.blocks as unknown as FrontendMessageBlock[] | undefined,
    // AB-11 修复：finishReason 随消息落盘，全量刷新后前端可区分截断/错误/正常
    finishReason: message.finishReason,
  };
  try {
    await gateway.sendMessage(sessionId, unifiedMessage);
  } catch (err) {
    // BUG-H 修复（2026-08-26）：调用方要求落盘强一致（如提问回答 throwOnError）时
    // 必须上抛——原空 catch 吞掉错误，使 _addAndPersistMessage 的 throwOnError 成为死代码，
    // 前端"显示成功但数据未落盘"。默认仍吞错降级（持久化失败不影响主消息流）。
    if (options?.throwOnError) throw err;
    // @ignore-catch — 持久化失败不影响主消息流，已由 Proxy 的 .catch 记录日志
  }
}

/**
 * 判断 LLM 端点是否为本地服务（llama.cpp / Ollama 等）。
 * /tokenize 端点仅本地服务提供；对远程 API（OpenAI/DeepSeek 等）发起
 * /tokenize 会得到 401/404（无鉴权或端点不存在）——2026-08-13 日志排查发现
 * 每次流式回复前对 api.deepseek.com 的探测产生 20+ 次 status=401 噪音并
 * 误判"端点不可用"。远程 baseUrl 直接跳过（R 修复 2026-08-13）。
 */
export function isLocalLlmEndpoint(baseUrl: string): boolean {
  try {
    const { hostname } = new URL(baseUrl);
    const isLocal =
      hostname === LOCAL_SERVICE_HOST ||
      hostname === LOCAL_HTTP_HOST ||
      hostname === WILDCARD_BIND_HOST ||
      hostname === '::1';
    // 端点识别排查日志：baseUrl → hostname → 判定结果。
    // 决策链路：本地 → 走 llama.cpp 精确截断；远程 → 跳过 /tokenize（避免 401 噪音）
    logger.info('isLocalLlmEndpoint 判定', {
      baseUrl,
      hostname,
      isLocal,
    });
    return isLocal;
  } catch {
    // 非法 URL 按远程处理（跳过 /tokenize），不抛错中断主流程
    logger.warn('isLocalLlmEndpoint 解析失败（非法 URL，按远程处理）', {
      baseUrl,
    });
    return false;
  }
}
