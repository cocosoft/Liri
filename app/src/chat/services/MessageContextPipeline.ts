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
import { estimateMessagesTokens } from '../../ai/tokenizer/TokenEstimator';
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
  let removedInCleanup = false;
  const lenBeforePop = apiMessages.length;
  while (
    apiMessages.length > 0 &&
    apiMessages[apiMessages.length - 1].role === 'tool'
  ) {
    apiMessages.pop();
    removedInCleanup = true;
  }
  if (apiMessages.length < lenBeforePop) removedInCleanup = true;

  // 中间孤立 tool 消息清理：
  // 先正向扫描收集所有已知 tool_call_id，再反向移除孤儿 tool 消息
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
  // P1-3 fix: Skills 作为 User Message 注入 — 在最后一条 user message 前插入。
  // 注意：ensureFresh() 无外部调用点，cache.l1 恒为空；且原注入代码位于上下文超限路径尾部，
  // 正常请求（未超限）早退导致技能列表从未注入 LLM。这里在早退前统一刷新并注入。
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
    apiMessages.length = 0;
    for (const msg of injected)
      apiMessages.push(msg as Record<string, unknown>);
  } catch (err) {
    // Skills 注入失败不阻塞主流程
    await handleError(err, {
      module: 'chat:context-pipeline',
      action: 'injectSkills',
    });
  }

  if (maxContextTokens <= 0) return;

  // 输出预算：显式扣除本次请求的输出 token 上限（maxTokens），保证"输入+输出"不超窗口。
  // 上限封顶 40% 窗口，防止 maxTokens 异常大挤占输入空间（llama.cpp n_ctx=4096 场景
  // 若只留 15% 缓冲，输入 3482 + 请求输出 4096 结构性必超）。
  const RESPONSE_BUFFER_TOKENS =
    outputBudgetTokens && outputBudgetTokens > 0
      ? Math.min(outputBudgetTokens, Math.round(maxContextTokens * 0.4))
      : Math.round(maxContextTokens * 0.15);
  const SAFE_LIMIT = maxContextTokens - RESPONSE_BUFFER_TOKENS;

  const estimatedTokens = estimateMessagesTokens(
    apiMessages as { content?: string | unknown; role?: string }[]
  );
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
  // 小窗口模型（<64K，如 llama.cpp n_ctx=4096）按 token 预算反推保护条数：
  // 保护最近消息直至约占 SAFE_LIMIT 的 50%，防止"至少 20 条"本身占满窗口导致截断压不下去；
  // 大窗口保持原"条数比例"逻辑（下限 20 / 上限 100）。
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

  // 第一遍：优先丢长消息（保护短 user 指令，如"继续""好的"）
  for (let i = 0; i < nonSystemMessages.length - protectedCount; i++) {
    if (currentTokens <= SAFE_LIMIT) break;

    const msg = nonSystemMessages[i] as Record<string, unknown>;
    const msgTokens = estimateMessagesTokens([
      msg as { content?: string | unknown; role?: string },
    ]);
    if (isShortUserMsg(msg)) continue;
    currentTokens -= msgTokens;
    toDrop.add(i);
    dropCount++;
  }
  // 第二遍：仍超限则也丢短 user 消息（修复 BUG：此前短消息 continue 导致 toDrop 恒空、截断零生效）
  if (currentTokens > SAFE_LIMIT) {
    for (let i = 0; i < nonSystemMessages.length - protectedCount; i++) {
      if (currentTokens <= SAFE_LIMIT) break;
      if (toDrop.has(i)) continue;
      const msg = nonSystemMessages[i] as Record<string, unknown>;
      if (!isShortUserMsg(msg)) continue;
      const msgTokens = estimateMessagesTokens([
        msg as { content?: string | unknown; role?: string },
      ]);
      currentTokens -= msgTokens;
      toDrop.add(i);
      dropCount++;
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
  llmClient: { getProviderId(): string } | undefined,
  imageContextService: ImageContextService,
  getMemoryContext?: (sessionId: string) => string
): Promise<string> {
  const providerId = llmClient?.getProviderId() || '';
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
    mode: 'conversation',
  });

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
  const basePrompt = currentGoal
    ? prompt +
      `\n\n## 当前会话目标\n你正在协助用户完成以下任务。对话中可能包含较早的无关话题，请以当前目标为准：\n\n${currentGoal}` +
      memorySection +
      `\n\n${MEMORY_CONTEXT_RULES}${imageContext}\n\n${IMAGE_CHAIN_RULES}`
    : prompt +
      memorySection +
      `\n\n${MEMORY_CONTEXT_RULES}${imageContext}\n\n${IMAGE_CHAIN_RULES}`;

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
