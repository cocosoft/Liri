// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 上下文截断与分页切点（2026-11-18，从 `MessageContextPipeline` 外移，拆分批 4）
//
// 三件事：① `truncateApiMessages`（技能注入 + 摘要压缩 + 截断退化）；
// ② `computePaginationPoint` / `windowStartForBudget`（C 阶段分层切窗的切点计算）；
// ③ `truncateByPreciseTokens`（llama.cpp 精确分词，根治估算低估）。
// 对外符号与实现逐字搬迁，行为与日志 module 名（`chat:context-pipeline`）均不变。

import { getLogger } from '@openliri/infra/monitoring';
import { handleError } from '@openliri/infra/error';
import type { ChatSession } from '@modules/session/types/session.js';
import {
  estimateMessagesTokens,
  estimateMessagesTokensCooperative,
  yieldToEventLoop,
} from '@modules/ai';
import { isLocalLlmEndpoint } from '../ChatHelper';
import { skillInjectionService } from '@modules/skills';
import {
  DEFAULT_RETENTION_WARN_RATIO,
  measureRetention,
} from '@modules/context';
import { sanitizeApiMessages } from './messageSanitizer';
import { SHORT_USER_MSG_THRESHOLD } from './defaults';

const logger = getLogger('chat:context-pipeline');

/** 消息内容 → 保留度探针用纯文本（非字符串按 JSON 展平；空 ⇒ ''） */
function contentText(message: Record<string, unknown>): string {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (content === undefined || content === null) return '';
  return JSON.stringify(content);
}

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

// 2026-11-18（§48 拆分批 2）：`contextLayeringEnabled` / `LAYERING_HINT(_CODE)` /
// `isCodeContextMessage` 已外移到 `./context/contextLayering`。

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
        ? Math.max(3, Math.min(20, Math.round((SAFE_LIMIT * 0.5) / avgPerMsg)))
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
    // 保留度探针：丢弃/保留两边的关键实体对照（只告警，不改截断决策）
    const retention = measureRetention(
      apiMessages
        .filter((_, i) => dropped[i])
        .map(contentText)
        .join('\n'),
      kept.map(contentText).join('\n')
    );
    if (retention.total > 0 && retention.ratio < DEFAULT_RETENTION_WARN_RATIO) {
      logger.warn('truncate:precise — 低保留度（关键实体随截断丢失）', {
        baseUrl: normalizedBase,
        droppedCount: dropCount,
        ratio: Number(retention.ratio.toFixed(3)),
        total: retention.total,
        retained: retention.retained,
        missing: retention.missing,
      });
    }
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
