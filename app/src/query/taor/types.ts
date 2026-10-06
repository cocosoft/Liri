/**
 * taor/types.ts — TAORLoop 的类型契约与依赖注入接口
 *
 * 由 `query/TAORLoop.ts` 外迁（大文件拆分，见
 * `.trae/specs/file-size-debt-partition-plan.md` §42）：**只搬不改**（含全部原注释）。
 * 依赖方向：本模块**零依赖宿主**；宿主与其它模块经 `TAORLoop.ts` 的 re-export 取用
 * （公开面不变）⇒ 无循环。
 */

import type { ChatMessage } from '@modules/ai/models/types.js';
import type { TokenBudgetConfig } from '../TokenBudget.js';
import { TAORPhase } from '../types.js';
import type {
  TAORCheckpoint,
  TAORCheckpointKind,
  TAORCheckpointStorage,
} from '../types.js';
import type { VerifierAgentConfig } from '../VerifierAgent.js';
import type { StopHookReason } from '../StopHooks.js';
import type { TerminationReason } from '../ReActLoop.js';

// ─── TAORLoop 依赖注入接口 ────────────────────────────
/**
 * TAORLoop 依赖注入接口（对标 cc_code QueryDeps）
 *
 * 由 ChatManager 和 PDCA 分别实现，通过 TAORLoop.run() 注入。
 * 品牌类型防止意外结构化类型匹配。
 */
declare const TAOR_LOOP_DEPS_BRAND: unique symbol;
export interface TAORLoopDeps {
  readonly [TAOR_LOOP_DEPS_BRAND]: typeof TAOR_LOOP_DEPS_BRAND;

  /** LLM 流式调用 */
  callModel: (
    messages: ChatMessage[],
    signal: AbortSignal,
    // C1：max_output 翻倍重试时透传输出上限
    opts?: { maxOutputTokens?: number }
  ) => AsyncGenerator<{
    type: string;
    content?: string;
    toolCall?: unknown;
    [k: string]: unknown;
  }>;

  /** 工具批量执行 */
  executeTools: (
    toolCalls: Array<{
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    }>,
    signal: AbortSignal
  ) => Promise<
    Array<{
      toolCallId?: string;
      toolName?: string;
      result?: unknown;
      error?: string;
    }>
  >;

  /** 消息持久化 */
  persistMessages: (
    messages: ChatMessage[],
    signal?: AbortSignal
  ) => Promise<void>;

  /** 流式 chunk 透传 */
  onStreamChunk?: (chunk: unknown) => void;

  /**
   * 事件写入通道（可选）：工具未完成终态 tool/canceled 补发用。
   * 与 ReActToolLoop 的 _appendStreamEvent 对应——TAOR 路径事件由 persistMessages
   * 落盘时批量生成，无实时事件通道，守卫拦截/中止时需显式补发终态。
   */
  appendStreamEvent?: (
    sessionId: string,
    event: {
      type: string;
      seq: number;
      time: number;
      sessionId: string;
      data: Record<string, unknown>;
    }
  ) => Promise<{ ok: boolean }>;

  /** 当前会话事件尾号（可选）：补发 tool/canceled 时分配 seq 用 */
  getStreamTailSeq?: (sessionId: string) => Promise<number>;

  /**
   * 等待待处理落盘完成（可选）：补发 tool/canceled 前确保 assistant/tool_call
   * 事件已写入 events.jsonl（落盘为 fire-and-forget，需显式 flush 保证配对顺序）。
   */
  flushPendingPersists?: () => Promise<void>;

  /** 是否需要继续（无 tool_use 时停止） */
  needsFollowUp?: (response: unknown) => boolean;
}

/**
 * 品牌类型模拟值，用于工厂函数构造 TAORLoopDeps
 * 替代 as unknown as TAORLoopDeps 绕过，提供类型安全的构造方式
 */
const TAOR_LOOP_DEPS_BRAND_VALUE = Symbol(
  'TAORLoopDeps'
) as unknown as typeof TAOR_LOOP_DEPS_BRAND;

/**
 * 工厂函数：创建 TAORLoopDeps
 * 替代 as unknown as TAORLoopDeps 绕过，提供类型安全的构造方式
 */
export function createTAORLoopDeps(
  impl: Omit<TAORLoopDeps, typeof TAOR_LOOP_DEPS_BRAND>
): TAORLoopDeps {
  return {
    ...impl,
    [TAOR_LOOP_DEPS_BRAND_VALUE]: TAOR_LOOP_DEPS_BRAND_VALUE,
  } as TAORLoopDeps;
}

// ─── 类型定义 ──────────────────────────────────────────

/** M4：骨架化后的 TAORLoop 输入（runCollect 参数；deps 每次 run 注入） */
export interface TAORInput {
  /** 旧路径：纯 prompt（queryEngine 兜底构造默认 deps） */
  prompt?: string;
  /** 新路径：显式消息 + deps */
  messages?: ChatMessage[];
  deps?: TAORLoopDeps;
  /** A 阶段一（2026-09-05）：本次 run 的恢复归属——goal（PDL 目标运行）/ 缺省 chat。
   *   run 级载荷（不入 taorConfig 实例字段）：共享 loop 同时服务 chat 与 goal 时避免污染。 */
  ctxKind?: TAORCheckpointKind;
}

export interface TAORPhaseInfo {
  phase: TAORPhase;
  round: number;
  description?: string;
}

export interface TAORLoopConfig {
  maxTurns?: number;
  budgetConfig?: Partial<TokenBudgetConfig>;
  sessionId?: string;
  /** 是否启用检查点自动保存 */
  enableCheckpoint?: boolean;
  /** 检查点保存间隔（轮次） */
  checkpointInterval?: number;
  /** 检查点存储实现 */
  checkpointStorage?: TAORCheckpointStorage;
  /** 是否启用验证器代理（Phase 4），默认 true */
  enableVerifier?: boolean;
  /** 验证器配置 */
  verifierConfig?: Partial<VerifierAgentConfig>;
  /** Phase 3: VerifierAgent 专用模型调用函数（为 null 则共享主模型） */
  verifierModel?:
    | ((
        messages: Array<{ role: string; content: string }>,
        signal: AbortSignal
      ) => AsyncGenerator<{ content?: string }>)
    | null;
  /** 验证策略（Phase 2b）：AND/OR/TOOL_FIRST */
  verifyStrategy?: 'AND' | 'OR' | 'TOOL_FIRST';
  /** 是否启用自动 verify skill（Phase 2），默认 false */
  enableAutoVerify?: boolean;
  /** 自动验证最大重试次数，默认 3 */
  autoVerifyMaxRetries?: number;
  /** 自动验证超时 ms，默认 15000 */
  autoVerifyTimeoutMs?: number;
  /** Steering 消息队列（mid-turn 注入，不中断当前工具执行） */
  steeringMessages?: string[];
}

// runLogger 不在此接口中（由构造函数单独处理，避免 Required<> 强制）

export interface TAORLoopResult {
  turnCount: number;
  totalTokens: number;
  durationMs: number;
  stopReason: StopHookReason;
  /** E1①（2026-09-05，方案甲）：统一终止原因——供上层 markStepCompleted 透传落 PlanStep */
  terminationReason?: TerminationReason;
  /** 是否从检查点恢复 */
  resumed?: boolean;
  /** 恢复时的检查点ID */
  checkpointId?: string;
}

export interface TAORPhaseCallback {
  onPhase?: (info: TAORPhaseInfo) => void;
  onError?: (error: Error, phase: TAORPhase, round: number) => void;
  onBudgetWarning?: (percentUsed: number) => void;
  /** 检查点保存回调 */
  onCheckpointSaved?: (checkpoint: TAORCheckpoint) => void;
  /** 从检查点恢复回调 */
  onResumed?: (checkpoint: TAORCheckpoint) => void;
}
