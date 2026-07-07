// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 消息上下文管线
 * 从 ChatManager 拆分出的上下文管理模块，负责：
 * - API 消息清理（sanitize）
 * - 上下文截断（truncate）
 * - 工具循环历史压缩（compress）
 * - 跨轮对话摘要持久化（persist turn summary）
 * - 系统提示词组装（assemble system prompt）
 * - 当前会话目标提取（extract current goal）
 * - LLM 响应用量记录（record chat response usage）
 */
import { Logger, LogLevel } from '@modules/monitoring';
import type { ChatSession } from '../types/session.js';
import { toolResultRegistry } from '../../tool/ToolResultRegistry.js';
import { roughTokenCountForMessages } from '../../services/tokenManagement/TokenCounter.js';
import { sanitizePass } from './ChatHelper';
import { assembleSystemPrompt } from '@modules/services/prompt/PromptAssembler';
import { setCurrentKnowledgeQuery } from '@modules/services/prompt/KnowledgePromptProvider';
import type { SessionContext } from '@modules/memory/types/SessionContext';
import type { ImageContextService } from './ImageContextService';

const logger = new Logger({
  module: 'chat:context-pipeline',
  level: LogLevel.INFO,
});

/** 系统提示词中的上下文保持 + 行为约束规则 */
const MEMORY_CONTEXT_RULES = `## 上下文保持规则
你是当前会话的持续参与者。用户已提供的个人信息（姓名、背景、经历、偏好等）不会因上下文压缩而消失。若需要回顾用户信息，请使用 recall_memory 工具查询。**禁止**在已知用户信息的情况下重新询问姓名、联系方式、经历等基础问题。

## 输出行为约束
1. **语言统一**：始终使用与用户上一条消息相同的语言回答。
2. **思考过程分离**：所有内部推理、计划、工具调用前的思考必须放在 \\\`\\\` 标签内（例如 \\\`让我分析一下...\\\`）。标签内的内容不会展示给用户。不要在最终回答中泄漏内部思考。
3. **承诺-落地**：当你向用户承诺"我会出报告/做分析/调用工具"时，必须在同一回复中真正完成该动作。仅描述"准备做"而未实际输出结果，视为违反此约束。
4. **先分析再提问，区分开放式/封闭式问题**：使用 ask_user_question 工具前，必须先输出实质性分析/方案/计划让用户了解当前进展。禁止在未输出任何实质性内容的情况下直接调用 ask_user_question 向用户提问。选项中不应包含"继续"等暗示已有方案的模糊标签。**开放性问题（无法穷举选项的，如"你想做什么？""目标是什么？"）不要用 ask_user_question 工具，直接在正文中以自然语言提问即可。
5. **失败透明**：当工具调用失败时，明确告诉用户失败原因和影响，不要默默切换方案继续。
6. **直接行动，禁止反复确认**：用户给出任务后直接执行或回答，禁止问"要不要我继续？""你确认要执行吗？""需要我进一步分析吗？"等确认性问题，也禁止用 ask_user_question 工具以"是否继续推进"等形式变相确认。做完后直接输出结果即可。`;

/** 图像工具链式操作指南 */
const IMAGE_CHAIN_RULES = `## 图像工具链式操作
当用户请求涉及多个图像操作时（如"生成一张图，然后编辑它，再分析一下"），你可以在单次回复中**依次调用多个工具**组成链式操作。规则如下：

1. **识别链式意图**：用户消息中包含"然后""再""接着""并且"等连接词，通常表示多个操作意图。
2. **顺序执行**：按用户描述的顺序依次调用工具，**前一个工具的输出路径作为后一个工具的 inputPath**。
3. **路径传递**：
   - image_generate 返回 images[0].filePath → 作为后续 image/image_analysis 的 inputPath
   - image 返回 outputPath → 作为后续工具的 inputPath
   - canvas export 返回 outputPath → 作为后续工具的 inputPath
4. **常见链式模式**：
   - 生成 → 编辑：先 image_generate 生成图片，再 image 进行裁剪/调色/加水印等
   - 生成 → 分析：先 image_generate 生成图片，再 image_analysis 分析内容
   - 编辑 → 分析：先 image 编辑图片，再 image_analysis 分析结果
   - 生成 → 画布标注：先 image_generate 生成底图，再 canvas import 后在画布上标注
5. **错误处理**：如果链中某一步失败，报告失败原因并停止后续步骤。不要默默跳过失败继续。`;

// ============================================================
// 纯函数
// ============================================================

/**
 * API 消息清理：修复 tool/tool_calls 配对完整性
 *
 * 此方法从后往前遍历所有 assistant 含 tool_calls，
 * 逐条检查紧随其后的 tool 消息是否全部响应。
 */
export function sanitizeApiMessages(
  apiMessages: Record<string, unknown>[]
): void {
  // 第一轮清理：移除 tool 响应不完整的 assistant
  sanitizePass(apiMessages);

  // 末尾孤立 tool 消息（没有 preceding assistant 含 tool_calls）
  while (
    apiMessages.length > 0 &&
    apiMessages[apiMessages.length - 1].role === 'tool'
  ) {
    apiMessages.pop();
  }

  // 中间孤立 tool 消息清理：
  // 1) 没有 tool_call_id 的 tool 消息（API 无法处理）
  // 2) tool_call_id 不在任何前置 assistant 的 tool_calls 中
  const knownToolCallIds = new Set<string>();
  for (let i = 0; i < apiMessages.length; i++) {
    const msg = apiMessages[i];
    if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls as Array<{ id?: string }>) {
        if (tc.id) knownToolCallIds.add(tc.id);
      }
    }
  }
  for (let i = apiMessages.length - 1; i >= 0; i--) {
    if (apiMessages[i].role === 'tool') {
      const tcId = apiMessages[i].tool_call_id as string | undefined;
      if (!tcId || !knownToolCallIds.has(tcId)) {
        apiMessages.splice(i, 1);
      }
    }
  }

  // 第二轮清理：末尾 pop 和中间清理可能移除了有效 assistant 的 tool 消息，
  // 导致 assistant 变为孤立，需要再次清理
  sanitizePass(apiMessages);
}

/**
 * 压缩工具循环历史消息，用注册表中的压缩摘要替代冗长的累积消息
 *
 * @param currentRoundMessages 当前累积的循环消息
 * @param sessionId 会话 ID，用于从注册表获取压缩摘要
 * @param assistantMsg 当前轮的 assistant 消息（含 tool_calls）
 * @param toolResults 当前轮的 tool 结果消息
 * @returns 压缩后的消息数组
 */
export function compressToolHistory(
  currentRoundMessages: Record<string, unknown>[],
  sessionId: string,
  assistantMsg: Record<string, unknown>,
  toolResults: Record<string, unknown>[]
): Record<string, unknown>[] {
  const storedCalls = toolResultRegistry.listBySession(sessionId);
  if (storedCalls.length < 2) {
    return [...currentRoundMessages, assistantMsg, ...toolResults];
  }

  const compressedHistory = toolResultRegistry.getCompressedHistory(sessionId);

  const preservedMessages: Record<string, unknown>[] = [];

  // 保留系统消息和第一条用户消息作为上下文
  if (currentRoundMessages.length > 0) {
    preservedMessages.push(currentRoundMessages[0]); // system 消息
  }
  if (currentRoundMessages.length > 1) {
    preservedMessages.push(currentRoundMessages[1]); // 首条 user 消息
  }

  // 插入压缩摘要
  preservedMessages.push({
    role: 'user',
    content: `以下是此前工具执行的压缩摘要，如需完整详情请使用 get_tool_result 工具按工具调用 ID 查询。\n\n${compressedHistory}`,
  });

  // 追加当前轮完整消息
  preservedMessages.push(assistantMsg, ...toolResults);

  return preservedMessages;
}

/**
 * 跨轮对话摘要持久化
 * 在每个对话轮次完成后，从最近的 user 消息中提取关键决策，
 * 保存到会话元数据中。
 */
export function persistTurnSummary(session: ChatSession): void {
  if (!session || session.messages.length < 3) return;

  const userMessages = session.messages
    .filter((m) => m.role === 'user')
    .slice(-4);
  if (userMessages.length === 0) return;

  const decisionPoints = userMessages
    .map((m) => {
      const content = typeof m.content === 'string' ? m.content : '';
      if (content.length < 200) return `用户选择: ${content}`;
      const firstLine = content.split('\n')[0].slice(0, 100);
      return `用户意图: ${firstLine}...`;
    })
    .join('\n');

  session.metadata = {
    ...session.metadata,
    contextSummary: `此前对话决策摘要:\n${decisionPoints}`,
  };

  logger.debug('跨轮对话摘要已更新', {
    sessionId: session.id,
    summaryLength: decisionPoints.length,
  });
}

/**
 * 从会话中提取当前对话目标（最近一条实质性用户消息）
 * 过滤掉短回答、BUG 报告等非任务描述消息
 */
export function extractCurrentGoal(
  session: ChatSession,
  currentMessage?: string
): string | null {
  const candidate = currentMessage?.trim();
  if (candidate && candidate.length > 30) {
    return candidate;
  }

  const userMessages = session.messages
    .filter((m) => m.role === 'user')
    .slice(-8);

  for (let i = userMessages.length - 1; i >= 0; i--) {
    const rawContent = userMessages[i].content;
    const content = typeof rawContent === 'string' ? rawContent.trim() : '';
    if (content.length < 30) continue;
    if (/^(出?BUG|又出BUG|报错|又有BUG|出问题了)/.test(content)) continue;
    return content;
  }

  return null;
}

// ============================================================
// 参数化函数
// ============================================================

/**
 * 上下文长度保护：估算 apiMessages 的 Token 数，超限则优先使用 AI 摘要压缩，
 * 压缩失败或压缩不足时退化为截断旧消息（保留 system prompt + 最近 N 条消息）。
 * 截断后重新 sanitize 以修复 tool/tool_calls 配对完整性。
 *
 * @param apiMessages - 待发送的消息列表（会被原地修改）
 * @param maxContextTokens - 模型上下文窗口上限
 * @param sessions - 会话缓存 Map（用于注入跨轮对话摘要）
 * @param sessionId - 当前会话 ID
 */
export async function truncateApiMessages(
  apiMessages: Record<string, unknown>[],
  maxContextTokens: number,
  sessions: Map<string, ChatSession>,
  sessionId?: string
): Promise<void> {
  if (maxContextTokens <= 0) return;

  const RESPONSE_BUFFER_TOKENS = Math.round(maxContextTokens * 0.15);
  const SAFE_LIMIT = maxContextTokens - RESPONSE_BUFFER_TOKENS;

  const estimatedTokens = roughTokenCountForMessages(
    apiMessages as { content?: string | unknown; role?: string }[]
  );
  if (estimatedTokens <= SAFE_LIMIT) return;

  logger.warn(
    `上下文超限(兜底截断): 估算 ${estimatedTokens} tokens (上限 ${SAFE_LIMIT})，将截断旧消息`
  );

  const systemMsg = apiMessages.find(
    (m: Record<string, unknown>) => m.role === 'system'
  );
  const nonSystemMessages = apiMessages.filter(
    (m: Record<string, unknown>) => m.role !== 'system'
  );
  const protectedCount = Math.max(
    20,
    Math.min(100, Math.round(nonSystemMessages.length * 0.3))
  );

  const SHORT_USER_MSG_THRESHOLD = 200;
  let currentTokens = estimatedTokens;
  let dropCount = 0;
  const toDrop = new Set<number>();

  for (let i = 0; i < nonSystemMessages.length - protectedCount; i++) {
    if (currentTokens <= SAFE_LIMIT) break;

    const msg = nonSystemMessages[i] as Record<string, unknown>;
    const isShortUserMsg =
      msg.role === 'user' &&
      typeof msg.content === 'string' &&
      msg.content.length < SHORT_USER_MSG_THRESHOLD;
    if (isShortUserMsg) continue;

    const msgTokens = roughTokenCountForMessages([
      msg as { content?: string | unknown; role?: string },
    ]);
    currentTokens -= msgTokens;
    toDrop.add(i);
    dropCount++;
  }

  const keptNonSystem = nonSystemMessages.filter(
    (_: unknown, i: number) => !toDrop.has(i)
  );
  apiMessages.length = 0;
  if (systemMsg) apiMessages.push(systemMsg);
  for (const msg of keptNonSystem) apiMessages.push(msg);

  logger.warn(
    `上下文截断完成: 移除 ${dropCount} 条旧消息，估算剩余 ${currentTokens} tokens` +
      (currentTokens > SAFE_LIMIT
        ? `（仍超限 ${currentTokens - SAFE_LIMIT} tokens，将在 API 层被截断）`
        : '')
  );

  // 截断后重新 sanitize
  sanitizeApiMessages(apiMessages);

  // 注入跨轮对话摘要
  if (sessionId) {
    const session = sessions.get(sessionId);
    if (session?.metadata?.contextSummary) {
      const summaryContent = session.metadata.contextSummary as string;
      const insertIdx =
        apiMessages.length > 0 && apiMessages[0].role === 'system' ? 1 : 0;
      apiMessages.splice(insertIdx, 0, {
        role: 'system',
        content: `[跨轮决策摘要 — 以下为之前对话中用户已做出的关键决策]\n${summaryContent}`,
      });
      logger.debug('跨轮对话摘要已注入 LLM 请求', {
        sessionId,
        summaryLength: summaryContent.length,
      });
    }
  }
}

/**
 * 获取或组装系统提示词
 * 每次根据当前会话状态重新组装（包含动态段落如 sessionContext）
 *
 * @param session 当前会话
 * @param currentMessage 当前用户消息
 * @param llmClient LLM 客户端（用于获取 providerId）
 * @param imageContextService 图片上下文服务
 */
export async function assembleContextualSystemPrompt(
  session: ChatSession,
  currentMessage: string | undefined,
  llmClient: { getProviderId(): string } | undefined,
  imageContextService: ImageContextService
): Promise<string> {
  const providerId = llmClient?.getProviderId() || 'deepseek';
  const sessionContext: SessionContext = {
    sessionId: session.id,
    turnCount: session.messages.length,
    duration: Date.now() - (session.createdAt?.getTime() ?? Date.now()),
    startedAt: session.createdAt?.getTime() ?? Date.now(),
    tags: session.metadata?.tags,
  };

  if (currentMessage) {
    setCurrentKnowledgeQuery(currentMessage);
  }

  const prompt = await assembleSystemPrompt({
    providerId,
    sessionContext,
    mode: 'conversation',
  });

  const currentGoal = extractCurrentGoal(session, currentMessage);
  const imageContext = imageContextService.buildImageContextPrompt(session.id);
  const basePrompt = currentGoal
    ? prompt +
      `\n\n## 当前会话目标\n你正在协助用户完成以下任务。对话中可能包含较早的无关话题，请以当前目标为准：\n\n${currentGoal}` +
      `\n\n${MEMORY_CONTEXT_RULES}${imageContext}\n\n${IMAGE_CHAIN_RULES}`
    : prompt +
      `\n\n${MEMORY_CONTEXT_RULES}${imageContext}\n\n${IMAGE_CHAIN_RULES}`;

  return basePrompt;
}

/**
 * 记录 LLM 响应的令牌用量到 TokenTracker
 * @param sessionId 会话 ID
 * @param usage LLM 响应中的 usage 对象
 * @param tokenTracker 令牌追踪器实例
 */
export function recordChatResponseUsage(
  sessionId: string,
  usage: Record<string, number> | null | undefined,
  tokenTracker: { recordUsage(...args: any[]): void } | null
): void {
  if (!tokenTracker || !usage) return;
  const inputTokens = usage.prompt_tokens ?? usage.inputTokens ?? 0;
  const outputTokens = usage.completion_tokens ?? usage.outputTokens ?? 0;
  if (inputTokens === 0 && outputTokens === 0) return;
  tokenTracker.recordUsage(sessionId, {
    inputTokens,
    outputTokens,
    cacheReadInputTokens:
      usage.prompt_cache_hit_tokens ??
      usage.cache_read_input_tokens ??
      usage.cacheReadInputTokens ??
      0,
    cacheCreationInputTokens:
      usage.prompt_cache_miss_tokens ??
      usage.cache_creation_input_tokens ??
      usage.cacheCreationInputTokens ??
      0,
  });
}
