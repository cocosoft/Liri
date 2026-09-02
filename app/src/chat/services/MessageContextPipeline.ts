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
import { getLogger } from '@modules/monitoring';
import type { ChatSession } from '../types/session.js';
import { toolResultRegistry } from '../../tool/ToolResultRegistry.js';
import {
  estimateMessagesTokens,
  estimateMessagesTokensCooperative,
  yieldToEventLoop,
} from '@modules/ai';
import { isLocalLlmEndpoint, sanitizePass } from './ChatHelper';
import { assembleSystemPrompt } from '@modules/services/prompt/PromptAssembler';
import { setCurrentKnowledgeQuery } from '@modules/services/prompt/KnowledgePromptProvider';
import type { SessionContext } from '@modules/memory/types/SessionContext';
import type { ImageContextService } from './ImageContextService';

// P1-3: Skills as User Message injection (not System Prompt, avoids breaking cache_control prefix)
import { skillInjectionService } from '@modules/constants/systemPromptSections';
import { handleError } from '@modules/error';

const logger = getLogger('chat:context-pipeline');

/** 系统提示词中的上下文保持 + 行为约束规则 */
const MEMORY_CONTEXT_RULES = `## 上下文保持规则
你是当前会话的持续参与者。用户已提供的个人信息（姓名、背景、经历、偏好等）不会因上下文压缩而消失。若需要回顾用户信息，请使用 recall_memory 工具查询。**禁止**在已知用户信息的情况下重新询问姓名、联系方式、经历等基础问题。

## 输出行为约束
1. **语言统一**：始终使用与用户上一条消息相同的语言回答。
2. **思考过程分离（强制标签格式）**：你的每次回复必须按以下格式组织：
   \`\`\`
   <think>
   内部推理过程 - 工具调用计划、代码分析、文件查找。用户不可见。
   </think>
   <response>
   给用户看的最终回答。禁止重复 think 中的规划步骤。
   </response>
   \`\`\`
   **严格规则**：
   - <think> 标签内：放所有推理、规划、文件查找过程、代码分析、步骤描述
   - <response> 标签内：放最终用户可见的回答，简明扼要，禁止重复 think 中的规划描述
   - **禁止**在 <response> 标签外输出任何内容
   - **禁止**在 <response> 中泄漏"我先看看结构""让我分析一下"等内部规划语言
   - 如果本轮不需要推理（如简单问候），可省略 <think> 直接输出 <response> 内容
3. **承诺-落地**：当你向用户承诺"我会出报告/做分析/调用工具"时，必须在同一回复中真正完成该动作。仅描述"准备做"而未实际输出结果，视为违反此约束。
4. **先分析再提问，区分开放式/封闭式问题**：使用 ask_user_question 工具前，必须先输出实质性分析/方案/计划让用户了解当前进展。禁止在未输出任何实质性内容的情况下直接调用 ask_user_question 向用户提问。选项中不应包含"继续"等暗示已有方案的模糊标签。**开放性问题（无法穷举选项的，如"你想做什么？""目标是什么？"）不要用 ask_user_question 工具，直接在正文中以自然语言提问即可。
5. **失败透明**：当工具调用失败时，明确告诉用户失败原因和影响，不要默默切换方案继续。
6. **直接行动，禁止无信息量确认**：用户给出任务后直接执行或回答，禁止问"要不要我继续？""你确认要执行吗？"等无信息量的确认性问题。但在**真实决策点**（需求存在多义、方案需要用户选择方向、任务卡在关键岔路、执行结果与预期不符需要用户拍板时）**允许使用 ask_user_question 工具**提出有实质选项的封闭式问题（如"接下来优先推进哪个方向？"），选项必须具体可执行，禁止"继续/跳过/都行"等空泛标签。做完后直接输出结果即可。
7. **任务隔离**：仅响应最新一条用户消息提出的任务。对话历史中较早的用户请求和工具调用已全部完成，**禁止**重新执行、延续或引用历史请求中的工具调用（如图片生成、文件分析等），除非最新用户消息明确要求。`;

/** 本地模型（llama.cpp/Ollama）精简版行为约束 — 与 MEMORY_CONTEXT_RULES 差异：
 * 第 2 条去掉强制 <think>/<response> 标签格式（本地推理模型 R1 等有原生思考通道，
 * Liri 已自动提取 thinking，强制标签会让模型把标签输出到正文），改为"思考通道分离"表述 */
const LOCAL_MEMORY_CONTEXT_RULES = `## 上下文保持规则
你是当前会话的持续参与者。用户已提供的个人信息（姓名、背景、经历、偏好等）不会因上下文压缩而消失。**禁止**在已知用户信息的情况下重新询问姓名、联系方式、经历等基础问题。

## 输出行为约束
1. **语言统一**：始终使用与用户上一条消息相同的语言回答。
2. **思考过程分离**：推理、规划、分析等过程只放入思考通道（thinking），正文只输出对用户的最终回答。禁止在正文泄漏"我先看看结构""让我分析一下"等内部规划语言。如果本轮不需要推理（如简单问候），直接输出回答即可。
3. **承诺-落地**：当你向用户承诺"我会出报告/做分析/调用工具"时，必须在同一回复中真正完成该动作。仅描述"准备做"而未实际输出结果，视为违反此约束。
4. **失败透明**：当工具调用失败时，明确告诉用户失败原因和影响，不要默默切换方案继续。
5. **直接行动，禁止无信息量确认**：用户给出任务后直接执行或回答，禁止问"要不要我继续？""你确认要执行吗？"等无信息量的确认性问题。做完后直接输出结果即可。
6. **任务隔离**：仅响应最新一条用户消息提出的任务。对话历史中较早的用户请求和工具调用已全部完成，**禁止**重新执行、延续或引用历史请求中的工具调用，除非最新用户消息明确要求。`;

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

  // 收集所有已知 tool_call_id（用于判定孤儿 tool——与中间清理共用）
  const knownToolCallIds = new Set<string>();
  for (let i = 0; i < apiMessages.length; i++) {
    const msg = apiMessages[i];
    if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls as Array<{ id?: string }>) {
        if (tc.id) knownToolCallIds.add(tc.id);
      }
    }
  }

  // 末尾孤立 tool 消息（没有 preceding assistant 含 tool_calls）。
  // 2026-09-02 修复：原实现无条件 pop 末尾所有 tool 消息——[assistant(tool_calls),
  // tool(result)] 有效配对被误删（末尾 T1 被 pop → sanitizePass 再将失去配对的 A1
  // 删除）。工具轮每轮 reason 前（ReActToolLoop.beforeReasoning）调用本函数，导致
  // 工具结果每轮被清空 → 模型永远看不到工具结果 → 重复调用同一工具死循环
  // （实测 session_mtjjw6bmwj652x6dtm：_buildToolRoundMessages currentMessages 恒为 3）。
  // 仅当末尾 tool 无匹配 assistant 时移除。
  let removedInCleanup = false;
  const lenBeforePop = apiMessages.length;
  while (
    apiMessages.length > 0 &&
    apiMessages[apiMessages.length - 1].role === 'tool'
  ) {
    const last = apiMessages[apiMessages.length - 1] as {
      tool_call_id?: string;
    };
    if (last.tool_call_id && knownToolCallIds.has(last.tool_call_id)) break;
    apiMessages.pop();
    removedInCleanup = true;
  }
  if (apiMessages.length < lenBeforePop) removedInCleanup = true;

  // 中间孤立 tool 消息清理：
  // 先正向扫描收集所有已知 tool_call_id，再反向移除孤儿 tool 消息
  for (let i = apiMessages.length - 1; i >= 0; i--) {
    if (apiMessages[i].role === 'tool') {
      const tcId = apiMessages[i].tool_call_id as string | undefined;
      if (!tcId || !knownToolCallIds.has(tcId)) {
        apiMessages.splice(i, 1);
        removedInCleanup = true;
      }
    }
  }

  // 仅在清理步骤实际移除了消息时才执行再清理
  // （移除 tool 消息可能导致对应的 assistant 变为孤立）
  if (removedInCleanup) {
    sanitizePass(apiMessages);
  }
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

  // 保留系统消息和第一条用户消息作为上下文（按角色查找，不依赖位置）
  const sysMsg = currentRoundMessages.find(
    (m: Record<string, unknown>) => m.role === 'system'
  );
  if (sysMsg) preservedMessages.push(sysMsg);

  const firstUserMsg = currentRoundMessages.find(
    (m: Record<string, unknown>) => m.role === 'user'
  );
  if (firstUserMsg) preservedMessages.push(firstUserMsg);

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
 * T1/T4（2026-08-30）：技能注入块识别（metadata 标记 + 内容级兜底，
 * 与 SkillInjectionService.injectSkillsIntoMessageHistory 幂等判定一致）
 */
function isSkillsInjection(msg: Record<string, unknown>): boolean {
  const meta = msg.metadata as Record<string, unknown> | undefined;
  if (meta?.__skills_injection === true) return true;
  return (
    typeof msg.content === 'string' &&
    msg.content.includes('<available_skills>')
  );
}

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
  sessionId?: string,
  outputBudgetTokens?: number
): Promise<void> {
  // P1-3 fix: Skills 注入（原位于超限路径尾部，正常请求早退从未注入；此处早退前统一刷新注入）
  try {
    await skillInjectionService.ensureFresh();
    const injected = skillInjectionService.injectSkillsIntoMessageHistory(
      apiMessages as Array<{
        role: string;
        content: string;
        metadata?: Record<string, unknown>;
      }>
    );
    // 直接替换数组内容（保持引用）
    // 2026-08-30 修复：injectSkillsIntoMessageHistory 在 active 空/prompt 空时返回
    // **原数组引用**——`apiMessages.length = 0` 后再遍历同引用的 injected 会把
    // 数组自我清空（实测 T4 注入后 []）。**先展开复制再清空**（展开必须发生在
    // 清空之前，否则同引用下展开到的也是已清空的数组）。
    const toPush = [...injected];
    apiMessages.length = 0;
    for (const msg of toPush) apiMessages.push(msg as Record<string, unknown>);
  } catch (err) {
    // Skills 注入失败不阻塞主流程
    await handleError(err, {
      module: 'chat:context-pipeline',
      action: 'injectSkills',
    });
  }

  if (maxContextTokens <= 0) return;

  // 输出预算：扣除本次 maxTokens（封顶 40% 窗口），保证"输入+输出"不超窗（llama.cpp n_ctx=4096 需封顶）
  const RESPONSE_BUFFER_TOKENS =
    outputBudgetTokens && outputBudgetTokens > 0
      ? Math.min(outputBudgetTokens, Math.round(maxContextTokens * 0.4))
      : Math.round(maxContextTokens * 0.15);
  const SAFE_LIMIT = maxContextTokens - RESPONSE_BUFFER_TOKENS;

  // 2026-08-19 根因①修复：协作式估算，分批让出事件循环（批次耗时见 estimate:cooperative_* 日志）
  const estimatedTokens = await estimateMessagesTokensCooperative(
    apiMessages as { content?: string | unknown; role?: string }[]
  );
  logger.debug('truncate:estimate_done', { sessionId, estimatedTokens });
  if (estimatedTokens <= SAFE_LIMIT) return;

  logger.warn(
    `上下文超限(兜底截断): 估算 ${estimatedTokens} tokens (上限 ${SAFE_LIMIT}，输出预留 ${RESPONSE_BUFFER_TOKENS})，将截断旧消息`
  );

  const systemMessages = apiMessages.filter(
    (m: Record<string, unknown>) => m.role === 'system'
  );
  const nonSystemMessages = apiMessages.filter(
    (m: Record<string, unknown>) => m.role !== 'system'
  );
  // 小窗口（<64K）按 token 预算反推保护条数（约 SAFE_LIMIT 的 50%）；大窗口按条数比例（20-100）
  const isSmallWindow = SAFE_LIMIT < 64_000;
  const protectedCount = isSmallWindow
    ? Math.max(
        3,
        Math.min(
          20,
          Math.round(
            (SAFE_LIMIT * 0.5) /
              Math.max(
                estimatedTokens / Math.max(nonSystemMessages.length, 1),
                1
              )
          )
        )
      )
    : Math.max(20, Math.min(100, Math.round(nonSystemMessages.length * 0.3)));

  const SHORT_USER_MSG_THRESHOLD = 200;
  let currentTokens = estimatedTokens;
  let dropCount = 0;
  const toDrop = new Set<number>();

  const isShortUserMsg = (msg: Record<string, unknown>): boolean =>
    msg.role === 'user' &&
    typeof msg.content === 'string' &&
    msg.content.length < SHORT_USER_MSG_THRESHOLD;

  // 第一遍：优先丢长消息（保护短 user 指令，如"继续""好的"）—— 每 25 条让出事件循环并记录批次耗时
  let batchStart = Date.now();
  for (let i = 0; i < nonSystemMessages.length - protectedCount; i++) {
    if (currentTokens <= SAFE_LIMIT) break;
    const msg = nonSystemMessages[i] as Record<string, unknown>;
    // T4（2026-08-30）：注入块截断保护——技能注入块是长 user 消息，
    // 第一遍"优先丢长消息"不丢它（否则注入即删，BUG-4）
    if (isSkillsInjection(msg)) continue;
    const msgTokens = estimateMessagesTokens([msg as never]);
    if (isShortUserMsg(msg)) continue;
    currentTokens -= msgTokens;
    toDrop.add(i);
    if (++dropCount % 25 === 0) {
      logger.debug('drop_batch', { pass: 1, ms: Date.now() - batchStart });
      batchStart = Date.now();
      await yieldToEventLoop();
    }
  }
  // 第二遍：仍超限则优先丢注入块（技能索引价值低于用户消息，极端超限兜底），
  // 再丢短 user 消息（修复 BUG：此前短消息 continue 导致 toDrop 恒空、截断零生效）
  if (currentTokens > SAFE_LIMIT) {
    batchStart = Date.now();
    for (let i = 0; i < nonSystemMessages.length - protectedCount; i++) {
      if (currentTokens <= SAFE_LIMIT) break;
      if (toDrop.has(i)) continue;
      const msg = nonSystemMessages[i] as Record<string, unknown>;
      if (!isSkillsInjection(msg)) continue;
      const msgTokens = estimateMessagesTokens([msg as never]);
      currentTokens -= msgTokens;
      toDrop.add(i);
      if (++dropCount % 25 === 0) {
        logger.debug('drop_batch', { pass: '2a', ms: Date.now() - batchStart });
        batchStart = Date.now();
        await yieldToEventLoop();
      }
    }
  }
  if (currentTokens > SAFE_LIMIT) {
    batchStart = Date.now();
    for (let i = 0; i < nonSystemMessages.length - protectedCount; i++) {
      if (currentTokens <= SAFE_LIMIT) break;
      if (toDrop.has(i)) continue;
      const msg = nonSystemMessages[i] as Record<string, unknown>;
      if (!isShortUserMsg(msg)) continue;
      const msgTokens = estimateMessagesTokens([msg as never]);
      currentTokens -= msgTokens;
      toDrop.add(i);
      if (++dropCount % 25 === 0) {
        logger.debug('drop_batch', { pass: 2, ms: Date.now() - batchStart });
        batchStart = Date.now();
        await yieldToEventLoop();
      }
    }
  }

  const keptNonSystem = nonSystemMessages.filter(
    (_: unknown, i: number) => !toDrop.has(i)
  );
  apiMessages.length = 0;
  for (const msg of systemMessages) apiMessages.push(msg);
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

// ============================================================
// llama.cpp 精确 token 截断（2026-08-11 根治估算低估）
// ============================================================

/** 调 llama-server /tokenize 精确分词（优先 /v1/tokenize，失败回退 /tokenize） */
async function fetchTokenizeCount(
  baseUrl: string,
  content: string
): Promise<number | null> {
  for (const path of ['/v1/tokenize', '/tokenize']) {
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        tokens?: unknown[];
        count?: number;
      };
      if (Array.isArray(data.tokens)) return data.tokens.length;
      if (typeof data.count === 'number') return data.count;
    } catch {
      // 尝试下一个端点
    }
  }
  return null;
}

/**
 * C 阶段分层开关（P2-a，2026-09-02）：`CONTEXT_LAYERING !== 'off'` 默认开。
 * 长文档/代码库类任务（完整通读全文语义 > 分页取回体验）可会话级置 off 关闭。
 */
export function contextLayeringEnabled(): boolean {
  return process.env.CONTEXT_LAYERING !== 'off';
}

/**
 * C 阶段切点提示（P2-a，2026-09-02）：切窗生效时注入到保留段首条 user 消息前缀，
 * 告知模型早期记录可通过 session_lookup 取回（对齐 get_tool_result 摘要提示先例风格）。
 * 轻量（≤80 tokens），幂等（注入发生在请求构建期临时副本上，不落盘）。
 */
export const LAYERING_HINT =
  '（提示：为控制上下文，本次请求未携带较早的对话记录；需要时可调用 session_lookup 取回原始记录。）';

/**
 * C 阶段分页切点（P0，2026-09-02，v4 §7 + C 详设 §3）：token 动态阈值命中后
 * @returns 建议保留起点下标（0 = 无需切窗）
 */
export interface PaginationPoint {
  /** 保留段起点（0 = 不切，全量构建） */
  cutIndex: number;
}

/**
 * C 阶段分页切点（P0，2026-09-02，v4 §7 + C 详设 §3）：token 动态阈值命中后
 * 前移对齐到最近完整用户轮次，并执行 C-3 配对硬约束：
 *   - assistant 的 tool_calls 与其 tool/result 不能跨切点分离
 *   - 保留段头部不允许出现"孤立 tool/result"（其 assistant(tool_calls) 已被丢弃）
 * 预算/尾保护区与 windowStartForBudget（C-2）同口径，最终输入仍由
 * compactContext/truncateApiMessages 决定（对本窗口大概率早退）。失败回退 0。
 */
export async function computePaginationPoint(
  messages: Array<{ role: string; content: unknown }>,
  maxContextTokens: number,
  outputBudgetTokens?: number
): Promise<PaginationPoint> {
  try {
    if (maxContextTokens <= 0 || messages.length <= 2) return { cutIndex: 0 };
    // 输出预留（与 truncateApiMessages 同口径）
    const RESPONSE_BUFFER_TOKENS =
      outputBudgetTokens && outputBudgetTokens > 0
        ? Math.min(outputBudgetTokens, Math.round(maxContextTokens * 0.4))
        : Math.round(maxContextTokens * 0.15);
    const SAFE_LIMIT = maxContextTokens - RESPONSE_BUFFER_TOKENS;
    if (SAFE_LIMIT <= 0) return { cutIndex: 0 };

    // 协作式逐条估算（不构造全量 Record，仅 content 粗估）
    const per: number[] = new Array(messages.length);
    let total = 0;
    for (let i = 0; i < messages.length; i++) {
      per[i] = estimateMessagesTokens([messages[i] as never]);
      total += per[i];
      if ((i + 1) % 100 === 0) await yieldToEventLoop();
    }
    if (total <= SAFE_LIMIT) return { cutIndex: 0 };

    const nonSystemCount = messages.filter((m) => m.role !== 'system').length;
    const avgPerMsg = Math.max(total / Math.max(nonSystemCount, 1), 1);
    // 尾保护区（与 truncateApiMessages protectedCount 同口径）
    const protectedCount =
      SAFE_LIMIT < 64_000
        ? Math.max(
            3,
            Math.min(20, Math.round((SAFE_LIMIT * 0.5) / avgPerMsg))
          )
        : Math.max(20, Math.min(100, Math.round(nonSystemCount * 0.3)));

    // 从头部丢弃，直到剩余 ≤ SAFE_LIMIT 或仅剩保护区
    let start = 0;
    let kept = total;
    const maxDropable = Math.max(0, messages.length - protectedCount);
    while (start < maxDropable && kept - per[start] > SAFE_LIMIT) {
      kept -= per[start];
      start++;
    }
    // C-3（对齐到最近完整用户轮次起点，丢弃落入切点后的 assistant 残段）
    while (
      start < maxDropable &&
      start < messages.length - 1 &&
      messages[start].role !== 'user'
    ) {
      kept -= per[start];
      start++;
    }
    // C-3 配对硬约束：保留段头部不允许"孤立 tool/result"（其所属 assistant
    // tool_calls 已被丢弃）——切点回退，把整轮（含配对）一并保留，宁可多带一点
    while (
      start < messages.length &&
      start > 0 &&
      messages[start].role === 'tool'
    ) {
      start--;
      if (start > 0) kept += per[start];
    }
    while (start > 0 && messages[start].role !== 'user') {
      kept += per[start];
      start--;
    }
    if (start === 0) return { cutIndex: 0 };
    logger.warn('context:pagination_point — 构建期分页切点（C 阶段）', {
      messageCount: messages.length,
      estimatedTokens: total,
      safeLimit: SAFE_LIMIT,
      cutIndex: start,
      keptTokens: kept,
      protectedCount,
    });
    return { cutIndex: start };
  } catch {
    return { cutIndex: 0 };
  }
}

/**
 * C-2（2026-09-02，v4 §7.2）：请求构建期内存收敛 —— map 前置预算切窗。
 *
 * 当前管线"全量 filter/map/stringify → 压缩/截断"在超窗大会上话下，map 阶段
 * 先全量构造 apiMessages（内存 O(全量)）后又被截断丢弃。本函数在 map **之前**
 * 按预算从头部丢弃旧轮次，使 map/stringify 只处理幸存窗口，内存 O(全量)→O(窗口)。
 *
 * 语义不变保证：
 *  - 预算口径与 truncateApiMessages 一致（SAFE_LIMIT = maxCtx − 输出预留），
 *    输出预留/尾保护区公式同源复用
 *  - C-3：切点对齐到最近完整用户轮次（不切开 user→assistant 工具轮配对）
 *  - 只切"截断器本就要丢弃"的头部区，最终模型输入仍由
 *    compactContext/truncateApiMessages 决定（随后对已切窗口大概率早退）
 *  - 估算用源消息 content（≥ map 后内容），方向保守（偏多切，但仅限截断区）
 *  - 失败回退 0（CS03：预切是主动优化，不阻断构建；0 = 不切）
 *
 * @returns 建议保留起点下标（0 = 无需切窗）
 */
export async function windowStartForBudget(
  messages: Array<{ role: string; content: unknown }>,
  maxContextTokens: number,
  outputBudgetTokens?: number
): Promise<number> {
  const point = await computePaginationPoint(
    messages,
    maxContextTokens,
    outputBudgetTokens
  );
  return point.cutIndex;
}

/**
 * llama.cpp 场景发送前精确截断（根治：估算 4104 vs 真实 15843 低估 3.86 倍问题）。
 * 用服务端 /tokenize 对每条消息真实分词，从最旧非 system 消息开始丢弃，
 * 直到真实 token <= maxInputTokens（保护全部 system + 最后 2 条非 system）。
 * 仍超限时 warn 输出 system 占比——system prompt（工具定义/记忆）过大时，
 * 丢非 system 无法挽救，需精简 system prompt（另见日志提示）。
 */
export async function truncateByPreciseTokens(
  apiMessages: Record<string, unknown>[],
  baseUrl: string,
  maxInputTokens: number
): Promise<void> {
  // /tokenize 仅本地 llama.cpp 服务提供；远程 API（OpenAI/DeepSeek 等）发起
  // 探测会 401/404（R 修复 2026-08-13，日志中 20+ 次 status=401 噪音的根因）。
  // 远程端点直接跳过精确截断（本就无此端点，探测失败也只会走估算兜底）。
  if (!isLocalLlmEndpoint(baseUrl)) return;

  // llama-server 的 /tokenize 端点在根路径（不带 /v1），而 provider baseUrl 常带 /v1 后缀，
  // 不规范化会拼出 /v1/tokenize → 404 → 探测失败 → 精确截断被跳过（本次 400 最终根因）
  const normalizedBase = baseUrl.replace(/\/v1\/?$/, '');
  // 端点可用性探测：远程 API（OpenAI/DeepSeek 等）无 /tokenize 端点 → 一次探测失败后直接跳过，
  // 避免逐条消息发起无意义的请求（仅有 llama.cpp 等本地服务生效）
  const probeResult = await fetchTokenizeCount(normalizedBase, 'ping');
  if (probeResult === null) {
    logger.warn('truncate:precise — 端点不可用，跳过精确截断', {
      baseUrl: normalizedBase,
    });
    return;
  }

  const counts: number[] = [];
  let total = 0;
  for (const m of apiMessages) {
    const content = m.content;
    let n: number | null = null;
    if (typeof content === 'string' && content.length > 0) {
      n = await fetchTokenizeCount(normalizedBase, content);
    }
    if (n === null) {
      // /tokenize 不可用或 content 非纯字符串（图片等）→ 估算兜底
      n = estimateMessagesTokens([
        m as { role?: string; content?: string | unknown },
      ]);
    }
    counts.push(n);
    total += n;
  }
  logger.info('truncate:precise — 计数结果', {
    baseUrl: normalizedBase,
    probeResult,
    messageCount: apiMessages.length,
    total,
    maxInputTokens,
    perMessage: apiMessages.map((m, i) => ({
      role: (m as Record<string, unknown>).role ?? '?',
      contentType:
        typeof (m as Record<string, unknown>).content === 'string'
          ? 'string'
          : Array.isArray((m as Record<string, unknown>).content)
            ? `array(${((m as Record<string, unknown>).content as unknown[]).length})`
            : typeof (m as Record<string, unknown>).content,
      tokens: counts[i],
    })),
  });
  if (total <= maxInputTokens) return;

  const PROTECT_TAIL = 2;
  const nonSystemIdx: number[] = [];
  for (let i = 0; i < apiMessages.length; i++) {
    if (apiMessages[i].role !== 'system') nonSystemIdx.push(i);
  }
  const dropped = new Array<boolean>(apiMessages.length).fill(false);
  let current = total;
  let dropCount = 0;
  for (let k = 0; k < nonSystemIdx.length - PROTECT_TAIL; k++) {
    if (current <= maxInputTokens) break;
    const idx = nonSystemIdx[k];
    dropped[idx] = true;
    current -= counts[idx];
    dropCount++;
  }

  const systemTokens = apiMessages.reduce(
    (acc, m, i) => acc + (m.role === 'system' ? counts[i] : 0),
    0
  );
  if (current > maxInputTokens) {
    logger.warn(
      'truncate:precise — 精确截断后仍超限（system prompt 过大，丢非 system 无效）',
      {
        totalTokens: total,
        remainingTokens: current,
        maxInputTokens,
        systemTokens,
        systemPct: total > 0 ? Math.round((systemTokens / total) * 100) : 0,
        droppedCount: dropCount,
        baseUrl,
      }
    );
  } else if (dropCount > 0) {
    logger.warn('truncate:precise — 精确截断完成', {
      beforeTokens: total,
      afterTokens: current,
      maxInputTokens,
      systemTokens,
      droppedCount: dropCount,
    });
  }

  if (dropCount > 0) {
    const kept = apiMessages.filter((_: unknown, i: number) => !dropped[i]);
    apiMessages.length = 0;
    apiMessages.push(...kept);
  }

  // system prompt 兜底：丢完非 system 仍超限 → 迭代截断 system 内容（真实 token 校验收敛）
  // 场景：system prompt（工具定义/记忆）本身真实 > maxInputTokens，必须削减否则必 400
  if (current > maxInputTokens) {
    const keptNonSystemTokens = current - systemTokens;
    const targetSystemTokens = Math.max(
      Math.floor((maxInputTokens - keptNonSystemTokens) * 0.5),
      64
    );
    for (let i = 0; i < apiMessages.length; i++) {
      const m = apiMessages[i] as Record<string, unknown>;
      if (m.role !== 'system' || typeof m.content !== 'string') continue;
      const originalLen = (m.content as string).length;
      let systemStr = m.content as string;
      let guard = 0;
      while (guard++ < 12) {
        const n = await fetchTokenizeCount(normalizedBase, systemStr);
        if (n === null || n <= targetSystemTokens) break;
        const ratio = targetSystemTokens / n;
        systemStr = systemStr.slice(
          0,
          Math.max(Math.floor(systemStr.length * ratio), 8)
        );
      }
      if (systemStr.length < originalLen) {
        logger.warn('truncate:precise — system prompt 已截断（超限兜底）', {
          baseUrl,
          maxInputTokens,
          targetSystemTokens,
          systemCharsBefore: originalLen,
          systemCharsAfter: systemStr.length,
          remainingTokens: current,
        });
        m.content = systemStr;
      }
      break;
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
  llmClient: { getProviderId(): string; getBaseUrl?(): string } | undefined,
  imageContextService: ImageContextService,
  getMemoryContext?: (sessionId: string) => string
): Promise<string> {
  const providerId = llmClient?.getProviderId() || '';
  // 本地模型判定：baseUrl 指向 localhost/127.0.0.1 → 启用精简 system prompt
  const baseUrl =
    typeof llmClient?.getBaseUrl === 'function' ? llmClient.getBaseUrl() : '';
  const isLocal = baseUrl ? isLocalLlmEndpoint(baseUrl) : false;
  const sessionContext: SessionContext = {
    sessionId: session.id,
    turnCount: session.messages.length,
    duration: Date.now() - (session.createdAt?.getTime() ?? Date.now()),
    startedAt: session.createdAt?.getTime() ?? Date.now(),
    tags: session.metadata?.tags,
    projectId: (session.metadata as Record<string, unknown> | undefined)
      ?.projectId as string | undefined,
  };

  if (currentMessage) {
    setCurrentKnowledgeQuery(currentMessage);
  }

  const prompt = await assembleSystemPrompt({
    providerId,
    sessionContext,
    mode: isLocal ? 'local' : 'conversation',
  });

  if (isLocal) {
    logger.info(
      'assembleContextualSystemPrompt: 本地模型启用精简 system prompt',
      {
        baseUrl,
        providerId,
        mode: 'local',
        skippedSections: [
          'taskNegotiation',
          'shellDeclaration',
          'toolIntegrity',
        ],
        memoryRules: 'local(无强制think/response标签)',
        imageChainRules: false,
      }
    );
  }

  // 分层记忆注入（Phase 3.5）：将 memory.md 内容注入系统提示词
  let memorySection = '';
  if (getMemoryContext) {
    const memoryContent = getMemoryContext(session.id);
    if (memoryContent && memoryContent.length > 0) {
      memorySection = [
        '',
        '## 会话记忆（自动维护）',
        '以下是从本会话中自动提取的关键信息，用于保持长对话上下文连续性：',
        '',
        memoryContent,
        '',
        '**使用规则**：',
        '- 优先信任此记忆中的"决策记录"和"文件变更"，它们是已确认的事实',
        '- "关键讨论"部分是摘要，如需精确引用请使用 recall_memory 工具搜索原文',
        '- 不要重复记忆中已有的信息，除非用户明确要求',
        '',
        '**注意**：以下信息来自 memory.md，**无需使用 recall_memory 工具查询**——这些信息已经自动注入到此提示词中。',
      ].join('\n');
    }
  }

  const currentGoal = extractCurrentGoal(session, currentMessage);
  const imageContext = imageContextService.buildImageContextPrompt(session.id);
  // 本地模型：用精简版行为约束 + 跳过图像链式规则（image 工具已被裁剪，属死规则）
  const contextRules = isLocal
    ? LOCAL_MEMORY_CONTEXT_RULES
    : MEMORY_CONTEXT_RULES;
  const chainRules = isLocal ? '' : `\n\n${IMAGE_CHAIN_RULES}`;
  const basePrompt = currentGoal
    ? prompt +
      `\n\n## 当前会话目标\n你正在协助用户完成以下任务。对话中可能包含较早的无关话题，请以当前目标为准：\n\n${currentGoal}` +
      memorySection +
      `\n\n${contextRules}${imageContext}${chainRules}`
    : prompt +
      memorySection +
      `\n\n${contextRules}${imageContext}${chainRules}`;

  return basePrompt;
}

/**
 * @deprecated 自 2026-07-13。ChatManager 已内联输入校验 + TokenBudget，此函数无调用方。
 */
export function recordChatResponseUsage(
  sessionId: string,
  usage: Record<string, number> | null | undefined
): void {
  if (!usage) return;
  const inputTokens = usage.prompt_tokens ?? usage.inputTokens ?? 0;
  const outputTokens = usage.completion_tokens ?? usage.outputTokens ?? 0;
  if (inputTokens === 0 && outputTokens === 0) return;
  // 仅做输入校验，实际追踪由 trackUsage() 完成（ChatManager.recordChatResponseUsage 中调用）
}

/**
 * 检测指定位置是否在 markdown fenced code block (```) 内部
 */
function isInsideFencedBlock(content: string, pos: number): boolean {
  const fenceRegex = /```/g;
  let inside = false;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(content)) !== null) {
    if (match.index >= pos) break;
    inside = !inside;
  }
  return inside;
}

/**
 * 内容标签兜底处理：当模型未按要求使用 <think>/<response> 标签时，
 * 检测并补全标签结构，防止推理内容泄漏到用户可见回复中。
 *
 * 检测策略：
 * 1. 已有 <think> 或 <response> 标签 → 不作处理
 * 2. 无标签且内容以"规划语言"开头 → 尝试找到响应起点并分别包裹
 * 3. 无标签且无规划特征 → 包裹在 <response> 中
 *
 * @param content 原始累积内容
 * @returns 处理后的内容（可能被包裹在标签中）
 */
export function ensureThinkResponseTags(content: string): string {
  if (!content?.trim()) return content;

  // 已有标签 → 不处理
  if (/<think>/i.test(content) || /<response>/i.test(content)) {
    return content;
  }

  // 规划语言特征词（中英文混合）
  const planningPatterns = [
    /^(好的|OK|让我|我先|先看看|现在让我|我需要|我需要先|我来|I('ll| will)|Let me|First|Now let me)/,
    /^(用户想要|用户想让|用户要求|The user (want|ask|need))/,
  ];

  const hasPlanningPrefix = planningPatterns.some((p) =>
    p.test(content.trim())
  );

  if (!hasPlanningPrefix) {
    // 无规划特征 → 直接包裹为 <response>
    return `<response>${content}</response>`;
  }

  // 有规划前缀 → 尝试找到响应正文的起点
  // 常用分隔标记：markdown 标题、水平线、明确的"结论"段落
  const responseMarkers = [
    /\n(#{1,3}\s)/, // markdown heading: ## 标题
    /\n(---)/, // 水平线
    /\n(一句话结论|核心发现|总结|建议如下|报告|结果)\n/, // 中文结论标记
    /\n\*\*(结论|发现|建议|总结)\*\*/, // 粗体标记
  ];

  let splitIdx = -1;
  for (const marker of responseMarkers) {
    const m = content.match(marker);
    if (m?.index && m.index > 20 && !isInsideFencedBlock(content, m.index)) {
      splitIdx = m.index;
      break;
    }
  }

  if (splitIdx > 0) {
    const thinking = content.slice(0, splitIdx).trim();
    const response = content.slice(splitIdx).trim();
    return `<think>${thinking}</think>\n<response>${response}</response>`;
  }

  // 无法找到分隔点 → 整体包裹为 <response>（宁可漏过不可错杀）
  return `<response>${content}</response>`;
}

/**
 * 剥离 think/response 标签
 * - think 标签：移除标签及其内容（内部推理，用户不可见）
 * - response 标签：仅移除标签，保留内容（用户可见的最终回答）
 */
export function stripThinkResponseTags(content: string): string {
  if (!content?.trim()) return content;

  let result = content;

  // 移除 <think>...</think> 及变体标签（连同内容一起删除）
  // \1 反向引用匹配对应的结束标签名
  const thinkPattern =
    /<(think|thinking|reasoning|thought|reflection|analysis|internal)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
  result = result.replace(thinkPattern, '');

  // P3-7d（2026-09-02）：未闭合 think 块——<think> 开标签存在但无配对 </think>
  // （实测模型以 "</parameter>\n\n</tool_calls>" XML 残渣闭合思考内容，配对的 </think>
  // 永不出现），若不处理则整个思考草稿作为最终正文交付。负向前瞻
  // (?![\s\S]*?<\/\1\s*>) 确保仅在无配对闭合时剥离到末尾，已配对的不会被二次误伤。
  const unclosedThinkPattern =
    /<(think|thinking|reasoning|thought|reflection|analysis|internal)\b[^>]*>(?![\s\S]*?<\/\1\s*>)[\s\S]*$/gi;
  result = result.replace(unclosedThinkPattern, '');

  // 移除 <response>...</response> 标签（仅移除标签，保留内容）
  result = result.replace(/<response\b[^>]*>/gi, '');
  result = result.replace(/<\/response\s*>/gi, '');

  return result.trim();
}

/**
 * 剥离残留的工具调用 XML 标签（兜底清理）
 *
 * 当模型输出残缺工具调用（如仅输出 </parameter></invoke></tool_calls> 闭合标签、
 * 或被 scrubber 拒绝后残留的 <tool_calls> 开标签）时，这些标签不应暴露给用户
 * 或持久化到会话。StreamingToolCallScrubber 只擦除被验证为真实工具调用的块，
 * 孤立的闭合标签（</parameter>、</invoke>、</tool_calls>、</tool_call>）不在其擦除
 * 范围内，此处统一剥离，与前端 stripStructuralTags 行为对齐。
 */
export function stripOrphanToolTags(text: string): string {
  if (!text) return text;
  if (!text.trim()) return '';
  return text
    .replace(/<\/?(?:parameter|invoke|tool_call|tool_calls)\b[^>]*>/gi, '')
    .trim();
}
