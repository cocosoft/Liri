/**
 * taor/helpers.ts — TAOR 纯助手（续接指令常量 / trace 截断 / 停止原因映射 / steering 注入）
 *
 * 由 `query/TAORLoop.ts` 外迁（大文件拆分，见
 * `.trae/specs/file-size-debt-partition-plan.md` §42）：**只搬不改**（含全部原注释）。
 * 依赖方向：零依赖宿主（仅 `@modules/tasks` / `@modules/context` / `@modules/ai` 类型
 * 与 ReActLoop 的**类型**）⇒ 无循环。
 * 2026-10-08（§1.6 红线审计修复）：追加 steering 注入外迁 —— TAORLoop 基线 1999 行
 * （门禁上限 2000），本次修复的新增逻辑一并外迁至本文件，避免超限。
 */

import { CONTINUATION_TEMPLATES } from '@modules/constants/goalTemplates';
import type { ChatMessage } from '@modules/ai/models/types.js';
import { getLogger } from '@modules/monitoring';
import {
  createFragment,
  renderFragment,
  FRAGMENT_KIND_FIELD,
  messageProjector,
  resolveContextWindow,
} from '@modules/context';
import { estimateMessagesTokens } from '@modules/ai/tokenizer/TokenEstimator.js';
import type { SteeringEntry, TerminationReason } from '../ReActLoop.js';

const logger = getLogger('query:taorLoop');

/** L3（2026-09-06）：回合质量重试指令 —— **B2-3 收尾迁移（2026-09-23）**：
 *  文案唯一来源改为 `constants/goalTemplates`（2026-10-21 由 `tasks/goal/` 下沉常量层，
 *  故 `query` 侧经 `@modules/constants` 引用即可，无需跨层例外；原为"模块自持副本"，
 *  理由曾是避免 query→chat 反向依赖 —— 两份文案逐字重复属 CS01 违规，
 *  见 `.trae/specs/goal-entity.md §5.3.1 #1`）。
 *  batch 无 thinking/finishReason 可靠信号，仅 empty/planning 两类。 */
export const TAOR_EMPTY_RETRY_INSTRUCTION = CONTINUATION_TEMPLATES.empty;
export const TAOR_PLANNING_ONLY_RETRY_INSTRUCTION =
  CONTINUATION_TEMPLATES.planning;
/** planning-only 启发式判定（与 ReActToolLoop.PLANNING_ONLY_RE 同源，保守避免误判正常回答） */
export const TAOR_PLANNING_ONLY_RE =
  /(?:以下(?:是)?(?:我(?:的)?)?(?:执行)?计划|我的计划(?:如下|是)|\bplan(?:\s*:|\s+is|\s+to)\b|步骤\s*[:：]|接下来(?:我)?(?:将|会))/i;

/** trace 持久化用：将值安全截断为 JSON 摘要（默认 500 字符） */
export function truncateForTrace(value: unknown, maxLen = 500): string {
  try {
    const s = JSON.stringify(value);
    if (!s) return '';
    return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
  } catch {
    return String(value).slice(0, maxLen);
  }
}

/**
 * 文件 IO 循环拦截的**模型可见文案**（2026-10-31，口径：维持 abort 整轮，仅补可观测）。
 *
 * 原文案是常量「文件IO循环已被阻止」⇒ 模型无法分辨是「同一路径重复」还是
 * 「同一 pattern 重复」，只能原样重试。现带上检测器明细（`[IO] 连续读 … ×N`）与
 * pattern，并给出可操作方向；**终止语义不变**（真循环仍整轮终止）。
 *
 * @param detail 检测器返回的明细（`FileIOBlockResult.message`）
 * @param pattern `glob` / `grep` 的查询签名（缺省则不提）
 */
export function buildFileIoBlockReason(
  detail: string,
  pattern?: string
): string {
  return (
    `文件IO循环已被阻止（本次调用未执行）：${detail}` +
    `${pattern ? `；pattern=${pattern}` : ''}；整轮已终止 —— ` +
    '请改用不同的 pattern/路径，或基于已有结果直接交付'
  );
}

/**
 * 文件 IO 循环拦截的**完整可观测产物**：日志 + 模型可见 reason（2026-10-31）。
 *
 * 口径（用户裁定）：**维持 abort 整轮**，只补可观测。原日志只有 `tool+path`，
 * 模型可见文案是常量 ⇒ 模型无法分辨「同一路径重复」还是「同一 pattern 重复」，
 * 只能原样重试。现补 `pattern` 与检测器明细（`[IO] 连续读 … ×N`）。
 *
 * @returns 可直接 push 进 `blocked[]` 的拦截条目
 */
export function toFileIoLoopBlocked(
  call: { id: string; name: string; input?: unknown },
  filePath: string,
  detail?: string
): { id: string; name: string; reason: string } {
  const args = (call.input ?? {}) as Record<string, unknown>;
  const pattern = typeof args.pattern === 'string' ? args.pattern : undefined;
  const ioDetail = detail ?? '连续重复访问';
  logger.warn('文件IO循环已被阻止', {
    tool: call.name,
    path: filePath,
    pattern,
    detail: ioDetail,
  });
  return {
    id: call.id,
    name: call.name,
    reason: buildFileIoBlockReason(ioDetail, pattern),
  };
}

/**
 * A 档（2026-09-05，复查收口）：TAOR stopReason → 统一 TerminationReason 的纯映射。
 * 显式收口 loop_detected / timeout（对齐 StopHookReason 与骨架枚举），杜绝未知原因
 * 被 default 折叠成 completed 的误判（见 error_repairs 方案 A 记录）。导出便于单测。
 */
export function mapTaorStopReasonToTermination(
  reason: string | null | undefined
): TerminationReason {
  switch (reason) {
    case 'max_turns':
      return 'max_turns';
    case 'budget_exhausted':
      return 'budget_exhausted';
    case 'verifier_escalate':
      return 'verifier_escalate';
    case 'diminishing_returns':
      return 'diminishing_returns';
    case 'loop_detected':
      return 'loop_detected';
    case 'timeout':
      return 'timeout';
    case 'aborted':
      return 'aborted';
    case 'error':
      return 'error';
    default:
      return 'completed';
  }
}

/**
 * 输出上限翻倍的天花板（对齐 PilotDeck `OUTPUT_TOKEN_RETRY_CEILING`）。
 */
export const MAX_OUTPUT_TOKENS_CEILING = 64_000;

/**
 * TAOR 每轮**默认输出上限**（2026-10-31 真机取证）。
 *
 * 传输层缺省 `max_tokens=4096`（[`ChatCompletionsTransport`](../../ai/transports/ChatCompletionsTransport.ts)），
 * 而 agent 轮常把预算先花在推理上，再开始写大参数（`file_write` / `file_edit` 正文）⇒
 * 参数 JSON 在 4096 处被截断。真机单日 **80 次** `file_write`/`file_edit` 因
 * `rawPreview` 停在字符串中途而缺参；`finish_reason` 仍是 `tool_calls`（调用确实存在），
 * 走不到 `max_output` 重试分支（[`ErrorRecoveryManager`](../ErrorRecoveryManager.ts) 只认
 * `finish_reason=max_tokens`）⇒ 永远按 4096 重试。
 *
 * 取 8192：与 `ai:maxOutputRetry` 的起始档一致；未显式配置的用户不受影响
 * （`budgetConfig.maxOutputTokens` 仍优先）。
 */
export const TAOR_DEFAULT_MAX_OUTPUT_TOKENS = 8_192;

/**
 * 本轮应传给 provider 的输出上限：翻倍后的有效值 > 用户配置 > 默认（8192）。
 * 纯函数（便于单测），不读全局状态（CS02）。
 */
export function resolveAgentMaxOutputTokens(
  effective: number | undefined,
  configured: number | undefined
): number {
  return effective ?? configured ?? TAOR_DEFAULT_MAX_OUTPUT_TOKENS;
}

/**
 * C1：`max_output` 触发后的下一档输出上限（翻倍，封顶 {@link MAX_OUTPUT_TOKENS_CEILING}）。
 * 起点与 {@link resolveAgentMaxOutputTokens} 同源，避免两处各写一份 4096/8192。
 */
export function nextDoubledOutputCap(
  effective: number | undefined,
  configured: number | undefined
): number {
  return Math.min(
    resolveAgentMaxOutputTokens(effective, configured) * 2,
    MAX_OUTPUT_TOKENS_CEILING
  );
}

/**
 * Phase 3 Steering 安全过滤器（外迁自 `TAORLoop` 实例字段，**值逐字不变**）：
 * `maxLength` 2000 + 拦截 `system:` / `<|im_start|>` 注入构造。
 */
export const TAOR_STEERING_FILTER = {
  maxLength: 2000,
  blockedPatterns: [/system:\s*/i, /<\|im_start\|>/i],
} as const;

/** steering 入队校验的拒绝原因（`reason` 直接拼进既有日志文案，保持逐字一致） */
export type SteeringRejection =
  | { ok: true }
  | { ok: false; reason: 'too long'; meta: { length: number } }
  | { ok: false; reason: 'blocked content'; meta: { pattern: string } };

/**
 * steering 入队前安全校验（外迁自 `TAORLoop.injectSteering`；**判定与日志文案逐字不变**）。
 * 返回 `reason` 供调用方拼出 `Steering message rejected: <reason>`（与迁移前完全一致）。
 */
export function checkSteeringMessage(
  message: string,
  filter: {
    maxLength: number;
    blockedPatterns: readonly RegExp[];
  } = TAOR_STEERING_FILTER
): SteeringRejection {
  if (message.length > filter.maxLength) {
    return { ok: false, reason: 'too long', meta: { length: message.length } };
  }
  for (const pattern of filter.blockedPatterns) {
    if (pattern.test(message)) {
      return {
        ok: false,
        reason: 'blocked content',
        meta: { pattern: pattern.source },
      };
    }
  }
  return { ok: true };
}

/**
 * `context/steering` 的事件追加通道（最小结构契约，避免依赖 `TAORLoopDeps` 全量）。
 * 与 `ChatEventLogStore.appendStreamEvent` 的形状一致。
 */
export type SteeringEventAppend = (
  sessionId: string,
  event: {
    type: string;
    seq: number;
    time: number;
    sessionId: string;
    data: Record<string, unknown>;
  }
) => Promise<unknown>;

/** TAOR steering 注入依赖（`messages` 为注入目标：TAOR 路径 = 会话消息数组） */
export interface TaorSteeringInjectDeps {
  messages: ChatMessage[];
  appendStreamEvent?: SteeringEventAppend;
  sessionId?: string;
}

/**
 * 注入一批 steering：**先落盘、再注入**（§1.6「模型可见 ⇔ 已落盘」）。
 *
 * 为什么必须先落盘：`[STEERING]` 正文会作为 `role:'user'` 消息进入模型上下文 ⇒
 * 属模型可见输入；修复前只落 logger ⇒ 会话结束后无法从事件日志重建"模型当时看到了哪段
 * steering"（与 `goal/injected` 的 X2 缺口同族）。
 *
 * 顺序即契约，故落盘与注入**同处一个函数**，调用方无法只做一半。
 * 观测面缺失（单测替身未装配）⇒ **如实不落**（不伪造，CS04）；落盘失败**不阻断注入**
 * （属观测面，CS03）。
 */
export async function injectTaorSteering(
  deps: TaorSteeringInjectDeps,
  entries: readonly SteeringEntry[]
): Promise<void> {
  for (const entry of entries) {
    if (deps.appendStreamEvent && deps.sessionId) {
      try {
        // `seq: 0` ⇒ 由 `EventLogStorage.append` 在 mutex 内原子分配（P3-7a 约定）
        await deps.appendStreamEvent(deps.sessionId, {
          type: 'context/steering',
          seq: 0,
          time: Date.now(),
          sessionId: deps.sessionId,
          data: { text: entry.text, source: entry.source },
        });
      } catch {
        // @ignore-catch — 事件落盘属观测面，失败不得中断 steering 注入（CS03）
      }
    }
    // B3-2/CC-06：`[STEERING] ` 由片段类型给出，并写入结构化标记（CS02）
    deps.messages.push({
      role: 'user',
      content: renderFragment(
        createFragment({ kind: 'steering', text: entry.text })
      ),
      [FRAGMENT_KIND_FIELD]: 'steering',
    } as ChatMessage);
  }
}

/** 预发送体积闸的触发阈值（窗口占比）：达到即先压缩再发 */
export const PRE_SEND_COMPACT_RATIO = 0.7;

/**
 * 预发送体积闸（2026-10-31，用户裁定「做：预发送体积闸」）。
 *
 * 现状：只有**事后**恢复 —— 请求先被 provider 以 400 拒绝（单日 155 次、最大 1.79M tokens，
 * 窗口 1.05M），再 `compact_and_retry`；每轮白付一次被拒请求 + 一次全量压缩。
 *
 * 口径：发送前用**本轮 messages 估算**判定，达到窗口的 {@link PRE_SEND_COMPACT_RATIO} 就先
 * 调 `compactIfNeeded` 再发（不阻塞、不改变消息内容；压缩本身由 QueryEngine 决定是否真的动手）。
 * 估算器与预算记账同源（`estimateMessagesTokens`），窗口与预算同源（`resolveContextWindow`）。
 *
 * @returns 本次判定的估算/窗口值与是否触发了压缩（供日志与单测）
 */
export async function ensureContextWithinBudget(params: {
  messages: ChatMessage[];
  model: string;
  sessionId: string | undefined;
  compact: (sessionId: string) => Promise<void>;
  /** 覆盖阈值（仅单测用；生产恒用 {@link PRE_SEND_COMPACT_RATIO}） */
  ratio?: number;
}): Promise<{ estimated: number; window: number; compacted: boolean }> {
  const ratio = params.ratio ?? PRE_SEND_COMPACT_RATIO;
  const window = resolveContextWindow(params.model || '').tokens;
  if (!params.sessionId || !Number.isFinite(window) || window <= 0) {
    return { estimated: 0, window: 0, compacted: false };
  }
  const estimated = estimateMessagesTokens(params.messages);
  if (estimated < window * ratio) {
    return { estimated, window, compacted: false };
  }
  logger.warn(
    'taorLoop: 预发送体积达窗口阈值，先压缩再发（避免 400 后被动恢复）',
    {
      sessionId: params.sessionId,
      estimated,
      window,
      ratio,
    }
  );
  await params.compact(params.sessionId);
  return { estimated, window, compacted: true };
}

/**
 * `prompt_too_long` 截头重试（C1；自 `TAORLoop.truncateHeadForRetry` 外迁，逻辑与日志不变）。
 * 复用 A1 `MessageProjector.toolPairSafeTruncate`，保证截断不切断 tool 对。
 */
export function truncateMessagesHead(
  messages: ChatMessage[],
  keepRatio = 0.6
): ChatMessage[] {
  const keepCount = Math.max(2, Math.floor(messages.length * keepRatio));
  const projected = messageProjector.toolPairSafeTruncate(messages, keepCount);
  if (projected.messages.length >= messages.length) return messages;
  logger.warn('truncate_head_and_retry applied', {
    before: messages.length,
    after: projected.messages.length,
    warnings: projected.warnings.length,
  });
  return projected.messages;
}
