// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * agentPreReasoning —— 每轮 reason 前的检查点 / 动态上限 / 工具轮内压缩（ReActToolLoop 拆分批 U-22/S1）
 *
 * **来源**：从 `ReActToolLoop.ts` 外移 `beforeReasoning`（284 行）与 `_sanitizeForNewTask`（84 行）。
 *
 * **职责（单一：一轮推理开始前把上下文与轮次预算调到可用状态）**：
 *   ① 新任务首轮清理旧任务残留（注入指令 + 探索类工具对）
 *   ② 动态轮次上限扩容 + 跨 run 预算内存写 + 收敛 steering（距上限 CONVERGE_WINDOW 轮）
 *   ③ 周期性检查点（每 5 轮）
 *   ④ 工具轮内上下文保护：分层窗口压缩（含 no_effect 指数退避）→ 统一评估压缩 →
 *      发送前兜底截断 + 配对清理 + 内存画像
 *   ⑤ 主会话预算触顶 ⇒ steering 注入收尾指令（X8）
 *
 * **行为等价**：日志文案/级别、阈值常数、退避公式、`.catch` 兜底与顺序**逐字未变**。
 */

import type { ChatMessage } from '@modules/ai';
import { configManager } from '@modules/config';
import { compactionOrchestrator } from '@modules/context';
import { getMemoryPressureMonitor } from '@modules/monitoring';
import { EXTERNAL_FETCH_TOOLS } from '@modules/query';
import { getLogger } from '@modules/monitoring';
import {
  createFragment,
  FRAGMENT_KIND_FIELD,
  renderFragment,
} from '@modules/context';
import { injectMainSessionBudgetWrapUp } from '@modules/tasks';
import type { SteeringSource } from '@modules/session/types/eventPayloads';
import type { ChatSession } from '@modules/session/types/session.js';

import { memProfile } from '../monitoring/memProfile.js';
import {
  sanitizeApiMessages,
  truncateApiMessages,
} from './services/MessageContextPipeline';

const logger = getLogger('chat:reactToolLoop');

/** 分层窗口压缩的最小间隔（毫秒；`beforeReasoning` 独用） */
export const LAYER_COMPACT_MIN_INTERVAL_MS = 30_000;

/** 本簇读取/改写的循环状态（与宿主共享同一对象 ⇒ 就地改写即生效） */
export interface PreReasoningLoopState {
  messages: Record<string, unknown>[];
  toolTurnCount: number;
  consecutiveCompactNoEffect?: number;
  lastCompactRatio?: number;
}

export interface AgentPreReasoningDeps {
  sessionId: string;
  loopState: PreReasoningLoopState;
  /** 配置（`maxIterations` 会被动态扩容就地改写） */
  config: { maxIterations: number };
  /** 会话对象（检查点保存使用 messages/metadata/state） */
  session: ChatSession;
  saveCheckpointWithData: (
    sessionId: string,
    messages: unknown[],
    metadata: unknown,
    state: unknown,
    label: string,
    description: string,
    auto: boolean,
    tokenCount: number
  ) => Promise<unknown>;
  estimateMessagesTokens: (messages: Record<string, unknown>[]) => number;
  checkBeforeRequest: (
    messages: ChatMessage[],
    model: string
  ) => Promise<{
    decision: 'warn' | 'trigger' | 'skip';
    beforeTokens: number;
    snapshot: { tokens: number; maxTokens: number; ratio: number };
  }>;
  options?: { model?: string; maxTokens?: number };
  queueSteering: (text: string, source: SteeringSource) => void;
  resolveDynamicMaxIterations: () => { max: number; breakdown: unknown };
  publishToolTurnBudget: () => void;
  isConvergeSteeringPrompted: () => boolean;
  setConvergeSteeringPrompted: (value: boolean) => void;
  getLastLayerCompactAt: () => number;
  setLastLayerCompactAt: (value: number) => void;
  /** 宿主静态阈值（单一来源仍在 `ReActToolLoop`；此处仅接收值） */
  consts: {
    convergeWindow: number;
    layerCompactBackoffCapMs: number;
    compactSteadyRatio: number;
    compactNoEffectSkipThreshold: number;
  };
}

/**
 * 骨架 hook：每轮 `reason` 前执行（P11 清理 → 动态上限 → 检查点 → 工具轮内压缩 → 预算收尾注入）。
 */
export async function runBeforeReasoning(
  deps: AgentPreReasoningDeps
): Promise<void> {
  // P11（2026-09-01）：新对话轮次（用户新消息）首轮清理旧任务残留——
  // 旧任务的 [STEERING] 求助指令 + 探索类工具结果会污染上下文，导致模型无视
  // 用户最新消息、继续旧任务（实测 seq 1247-1248 模型明确纠结后仍陷旧任务）。
  if (deps.loopState.toolTurnCount === 0) {
    sanitizeForNewTask(deps);
  }

  // 动态上限（2026-09-01）：任务越复杂（未完成 todo 越多），轮次上限越高，
  // 避免长程任务在基础阈值（默认 30 轮）被误杀截断。仅扩容不缩容，硬顶 500。
  // 缺陷 A/C 修复（2026-09-25）：续期速率与消耗 1:1、todo 项读扩容快照；
  // 跨 run 预算（2026-09-25，spec §3.5 最小变体）：额度按**任务累计消耗**算 ⇒ 续段不回退
  // 续期斜坡，但本段仍可再至硬顶（长任务可持续推进；无任务级总量上限）。
  const { max: dynamicMax, breakdown } = deps.resolveDynamicMaxIterations();
  if (dynamicMax > deps.config.maxIterations) {
    logger.info('reactToolLoop:dynamic_max_turns_expanded', {
      sessionId: deps.sessionId,
      base: deps.config.maxIterations,
      expanded: dynamicMax,
      toolTurn: deps.loopState.toolTurnCount,
      expansionBreakdown: breakdown,
    });
    deps.config.maxIterations = dynamicMax;
  }
  // 跨 run 预算：内存写（每轮，零 IO）—— 落盘节流见 `_publishToolTurnBudget` 注释
  deps.publishToolTurnBudget();

  // R4（2026-09-16）：任务硬收敛——工具轮次距上限还剩 CONVERGE_WINDOW 轮时，注入强制
  // 收尾 steering。软收敛（非硬熔断多轮）：提示模型停止新探索、基于已掌握信息产出最终
  // 结论，避免长任务空转到被 max_tokens 截断才终止（截断常致输出被裁、任务半途而废）。
  // 锚定当前生效上限（动态扩容后），每会话仅注入 1 次。
  if (
    !deps.isConvergeSteeringPrompted() &&
    deps.config.maxIterations > 0 &&
    deps.loopState.toolTurnCount >=
      deps.config.maxIterations - deps.consts.convergeWindow
  ) {
    deps.setConvergeSteeringPrompted(true);
    deps.queueSteering(
      `⚠️ 你已接近本轮任务的最大工具轮次限制（当前 ${deps.loopState.toolTurnCount} / 上限 ${deps.config.maxIterations}），` +
        '剩余轮次不足，请停止新的探索/搜索。现在请直接基于已掌握的信息输出最终完整结论；' +
        '若部分关键数据确实缺失，请明确列出缺失项而非继续尝试获取，以便我后续补充。',
      'loop-guard'
    );
    logger.warn('reactToolLoop:converge_steering_injected', {
      sessionId: deps.sessionId,
      toolTurn: deps.loopState.toolTurnCount,
      maxIterations: deps.config.maxIterations,
    });
  }

  // 3. 周期性检查点：每 5 轮保存（失败不阻塞，对齐旧类 _savePeriodicCheckpoint）
  if (
    deps.loopState.toolTurnCount > 0 &&
    deps.loopState.toolTurnCount % 5 === 0
  ) {
    try {
      const session = deps.session;
      await deps.saveCheckpointWithData(
        session.id,
        session.messages,
        session.metadata,
        session.state,
        `auto-round-${deps.loopState.toolTurnCount}`,
        `工具执行第 ${deps.loopState.toolTurnCount} 轮自动检查点`,
        true,
        deps.estimateMessagesTokens(
          session.messages as unknown as Record<string, unknown>[]
        )
      );
    } catch {
      // 检查点保存失败不影响执行（@ignore-catch）
    }
  }

  // 4. 工具轮内上下文保护（2026-08-23 修复）：
  //    消息随工具轮累积膨胀（LLM 回复 + 工具结果逐轮回填），而主流程压缩只在
  //    streamMessageFlow 首轮评估一次，工具轮内不再评估 → 长工具会话请求超限
  //    （实测 deepseek-v4-flash 1M 窗口请求 1.78M，OpenAI stream error 400）。
  //    每轮 reason 前对齐主流程：① 评估 → 超限压缩 loopState.messages（本轮 LLM 输入）
  //    ② 发送前兜底截断（压缩不足/未触发时丢弃旧消息，确保输入 ≤ 窗口 - 输出预留）。
  try {
    const session = deps.session;
    const model = (deps.options?.model as string | undefined) ?? '';
    // 分层窗口压缩触发（2026-09-02，C 单轮长任务残留风险收口）：
    // 工具轮内压缩原按模型 ctx 触发（deepseek-v4-flash 1M → ~60-75% ≈ 600-750K），
    // 单轮长任务（无 user 边界、computePaginationPoint 禁止头部切窗）在该点之前
    // 上下文/构建分配已很大。此处估算超 REACT_LAYER_WINDOW_TOKENS（默认 45K，
    // 设 0 关闭）时提前对旧轮做分层压缩（Tier2 snip + 既有后台摘要链兜底），
    // 把单请求封顶在 ~45K 附近，降低重复构建/分配对 RSS 与 GC STW 的压力。
    // 经统一出入口（R05-012）
    const baseWindow = Number(
      configManager.env('REACT_LAYER_WINDOW_TOKENS', '45000')
    );
    // 内存水位 tick（工具轮边界驱动；零日志除非级别变化）
    getMemoryPressureMonitor().tick();
    // 压力（L1+）下收紧分层窗口（缩小工作集，OS kswapd 式提前收缩）
    const layerWindowTokens =
      baseWindow > 0
        ? getMemoryPressureMonitor().effectiveLayerWindow(baseWindow)
        : 0;
    // R2（2026-09-16）：路径①分层窗口压缩也接入 consecutiveCompactNoEffect 退避——
    // 基础 30s 间隔按 no_effect 次数指数（2^n，n 封顶 4）递增，上限 LAYER_COMPACT_BACKOFF_CAP，
    // 避免"context 恒超窗口 → 每 30s 必触 + 无退避"的高频空转白跑（no_effect 计数见 L467-479）。
    const layerNoEffect = deps.loopState.consecutiveCompactNoEffect ?? 0;
    const layerMinIntervalMs = Math.min(
      LAYER_COMPACT_MIN_INTERVAL_MS * (1 << Math.min(layerNoEffect, 4)),
      deps.consts.layerCompactBackoffCapMs
    );
    if (
      layerWindowTokens > 0 &&
      deps.loopState.messages.length > 0 &&
      Date.now() - deps.getLastLayerCompactAt() > layerMinIntervalMs
    ) {
      const estLayer = deps.estimateMessagesTokens(deps.loopState.messages);
      if (estLayer > layerWindowTokens) {
        deps.setLastLayerCompactAt(Date.now());
        logger.warn('reactToolLoop:分层窗口压缩触发（提前压缩点）', {
          sessionId: session.id,
          toolTurn: deps.loopState.toolTurnCount,
          messageCount: deps.loopState.messages.length,
          estimatedTokens: estLayer,
          layerWindow: layerWindowTokens,
        });
        // 反向信号（2026-09-02 v1.1 §3.2）：压力下窗口收紧导致同一任务内
        // 反复分层压缩（可能过度收紧/重做）→ 上报 monitor，60s 内 ≥2 次放宽窗口
        getMemoryPressureMonitor().recordReverseSignal(
          session.id,
          'react 分层窗口压缩触发'
        );
        // R2①（2026-09-16 fix A）：去掉 skipTier3Sync，循环内同步执行 Tier3 迭代折叠。
        // 根因：skipTier3Sync 使 LLM 折叠在 ReAct 循环内从不执行（且无人调用 compactSessionInBackground），
        // 而 Tier2 snip 因 ReAct 单任务 user 轮次少（turns≤6）天然不生效 → applied 恒 false → 退避白跑。
        // 这是 ReAct 循环内唯一能真实削减上下文的路径，代价是工具循环最多让步 60s（_runFullCompactionWithTimeout 兜底）。
        const layered = await compactionOrchestrator.compact(
          deps.loopState.messages as unknown as ChatMessage[],
          { model, sessionId: session.id },
          {
            preEvaluated: {
              decision: 'trigger',
              beforeTokens: estLayer,
              snapshot: {
                tokens: estLayer,
                maxTokens: layerWindowTokens,
                ratio: estLayer / layerWindowTokens,
              },
            },
          }
        );
        if (layered.applied) {
          deps.loopState.messages = layered.messages as unknown as Record<
            string,
            unknown
          >[];
          deps.loopState.consecutiveCompactNoEffect = 0;
          logger.info('reactToolLoop:分层窗口压缩完成', {
            sessionId: session.id,
            toolTurn: deps.loopState.toolTurnCount,
            afterMessageCount: layered.messages.length,
          });
        } else {
          // R2（2026-09-16）：路径①压缩未生效也递增 no_effect —— 与路径②行为对齐，
          // 触发指数退避（见 L422-429），避免高频白跑；计数与路径②共享，稳态豁免判据见 L493-499。
          deps.loopState.consecutiveCompactNoEffect =
            (deps.loopState.consecutiveCompactNoEffect ?? 0) + 1;
          logger.warn('reactToolLoop:分层窗口压缩未生效（触发退避）', {
            sessionId: session.id,
            toolTurn: deps.loopState.toolTurnCount,
            consecutiveNoEffect: deps.loopState.consecutiveCompactNoEffect,
          });
        }
      }
    }
    if (deps.loopState.messages.length > 0) {
      const evalResult = await deps.checkBeforeRequest(
        deps.loopState.messages as unknown as ChatMessage[],
        model
      );
      // 压缩失败暂停续接（2026-09-22）：记录本轮**实测**占用比 —— `onIncompleteTurn`
      // 据此区分"压不动且吃紧"（该停续接）与"低占用会话里的输出截断"（该照常续接）。
      deps.loopState.lastCompactRatio = Number(evalResult.snapshot?.ratio ?? 0);
      if (evalResult.decision !== 'skip') {
        const ratio = Number(evalResult.snapshot?.ratio ?? 0);
        // R2（2026-09-16）：压缩稳态豁免——上下文占用远低于模型窗口（容量充足）且压缩已连续 no_effect，
        // 说明当前场景"压不动但也没有爆窗风险"；跳过本轮压缩尝试，避免每轮白跑全量 token 重估/大请求构造。
        const steadySkip =
          ratio < deps.consts.compactSteadyRatio &&
          (deps.loopState.consecutiveCompactNoEffect ?? 0) >=
            deps.consts.compactNoEffectSkipThreshold;
        if (steadySkip) {
          logger.info('reactToolLoop:compact_steady_state_skip', {
            sessionId: session.id,
            ratio: Number(ratio.toFixed(3)),
            windowTokens: evalResult.snapshot?.maxTokens,
            estimatedTokens: evalResult.snapshot?.tokens,
            consecutiveNoEffect: deps.loopState.consecutiveCompactNoEffect,
            toolTurn: deps.loopState.toolTurnCount,
          });
        } else {
          logger.info('reactToolLoop:工具轮内压缩评估触发', {
            sessionId: session.id,
            decision: evalResult.decision,
            tokens: evalResult.snapshot.tokens,
            maxTokens: evalResult.snapshot.maxTokens,
            ratio: Number(evalResult.snapshot.ratio.toFixed(3)),
            messageCount: deps.loopState.messages.length,
            toolTurn: deps.loopState.toolTurnCount,
          });
          const compactResult = await compactionOrchestrator.compact(
            deps.loopState.messages as unknown as ChatMessage[],
            { model, sessionId: session.id },
            { skipTier3Sync: true, preEvaluated: evalResult }
          );
          if (compactResult.applied) {
            deps.loopState.messages =
              compactResult.messages as unknown as Record<string, unknown>[];
            deps.loopState.consecutiveCompactNoEffect = 0;
            logger.info('reactToolLoop:工具轮内上下文压缩完成', {
              sessionId: session.id,
              beforeTokens: evalResult.snapshot.tokens,
              afterMessageCount: compactResult.messages.length,
              toolTurn: deps.loopState.toolTurnCount,
            });
          } else {
            deps.loopState.consecutiveCompactNoEffect =
              (deps.loopState.consecutiveCompactNoEffect ?? 0) + 1;
          }
        }
      }
      // 兜底：无论压缩是否生效，发送前强制截断（估算超窗口-输出预留才截断，否则零开销早退）
      await truncateApiMessages(
        deps.loopState.messages as unknown as Record<string, unknown>[],
        evalResult.snapshot.maxTokens,
        new Map([[session.id, session]]),
        session.id,
        (deps.options?.maxTokens as number | undefined) ?? undefined
      );
      // PAIR-GUARD（2026-08-30）：发送前无条件配对清理——truncateApiMessages 未超限时
      // 早退（不执行内部 sanitize），历史残留/事件派生可能产生"assistant tool_calls 无配对
      // tool 消息"→ OpenAI 400 "insufficient tool messages following tool_calls"。
      // 删除不完整 assistant 而非补占位，保守且与 OpenAI 配对约束一致（sanitize 幂等）。
      sanitizeApiMessages(
        deps.loopState.messages as unknown as Record<string, unknown>[]
      );
      // 内存画像（MEM_PROFILE=1）：压缩评估/截断后采样，观察工具轮消息累积对
      // RSS/堆的影响（排查 agentic 运行期 RSS 2-4.4GB 尖峰与 GC STW）
      memProfile('react-toolloop:presend', {
        sessionId: session.id,
        toolTurn: deps.loopState.toolTurnCount,
        messageCount: deps.loopState.messages.length,
      });
    }
  } catch {
    // 压缩/截断失败不阻断工具循环（@ignore-catch，CS03）
  }

  // X8（2026-09-23，Spec §5.5）：**主会话预算触顶 ⇒ 下一轮请求前经 steering 注入收尾指令**。
  // 一个**独立的、幂等的检查**（与 compression / token 预算决策无关，不改其既有行为）：
  // - **开销极小**：读库一次；该会话无"已触顶且尚未报告"的目标 ⇒ 立即返回；
  // - **幂等**：认领走 `budget_limit_reported_at` 的单条条件 UPDATE（`changes` 判首次）
  //   ⇒ 至多注入一次，跨进程/重启亦然（不用内存 flag）；
  // - **形态 = steering**：正文进 `steeringQueue`，骨架在**下一轮 reason 前**注入
  //   （`ReActLoop` 的 steering 消费点）⇒ 正是"下一轮请求前"，且**不主动发起新请求**（软停）。
  try {
    await injectMainSessionBudgetWrapUp({
      sessionId: deps.sessionId,
      steer: (text) => deps.queueSteering(text, 'budget'),
    });
  } catch (err) {
    // @ignore-catch — 收尾注入属"意图面"，读库/注入失败不得中断本轮推理（CS03）
    logger.warn('reactToolLoop:budget_wrapup_inject_failed', {
      sessionId: deps.sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * P11（2026-09-01）：新对话轮次首轮清理旧任务残留——解决"用户发新消息，模型仍按
 * 旧任务执行"（实测：模型 thinking 已看到"升级 CLI"新要求，但因旧任务上下文 +
 * [STEERING] 求助指令主导，行动上继续旧任务探索）。
 * 1) 移除注入指令残留（旧任务求助指令干扰）——按结构化标记 `FRAGMENT_KIND_FIELD`
 *    判别（`system`/`steering`），**不再**匹配 `[STEERING]`/`[SYSTEM]` 前缀字符串；
 * 2) 成对移除探索类工具（skill_view/glob/grep/web_fetch 等）的 assistant(tool_calls)
 *    + tool 结果——旧任务探索结果污染上下文（首轮时这些均为历史残留，无当前轮配对）；
 * 3) 若清理过旧任务残留，注入任务切换提示（最新用户指令优先）。
 * 注：普通对话文本/非探索类工具结果完整保留；注入提示本轮生效，下次新消息清理时移除。
 */
export function sanitizeForNewTask(deps: AgentPreReasoningDeps): void {
  const msgs = deps.loopState.messages;
  const cleaned: Record<string, unknown>[] = [];
  let skipExplorePair = false; // 正在跳过一组探索类工具结果
  let removedCount = 0;
  for (const m of msgs) {
    // 1) 移除系统注入指令残留（CS02：按**结构化标记**判别，禁止前缀字符串匹配）
    //    标记 `FRAGMENT_KIND_FIELD` 由所有注入指令的 push 点（本文件 4 处 + onSteering，
    //    以及 cross-loop 的 TAORLoop 注入点）写入；前缀口径变化不再影响本判别。
    const fragmentKind = m[FRAGMENT_KIND_FIELD];
    if (
      m.role === 'user' &&
      (fragmentKind === 'system' || fragmentKind === 'steering')
    ) {
      removedCount++;
      continue;
    }
    // 2) 成对移除探索类工具的 assistant(tool_calls) + 后续 tool 结果
    if (
      m.role === 'assistant' &&
      Array.isArray(m.tool_calls) &&
      m.tool_calls.length > 0
    ) {
      const names = m.tool_calls.map(
        (tc) =>
          (tc as { function?: { name?: string }; name?: string }).function
            ?.name ??
          (tc as { name?: string }).name ??
          ''
      );
      if (names.length > 0 && names.every((n) => EXTERNAL_FETCH_TOOLS.has(n))) {
        skipExplorePair = true;
        removedCount++;
        continue;
      }
    }
    if (m.role === 'tool') {
      if (skipExplorePair) {
        removedCount++;
        continue; // 跳过配对 tool 结果
      }
    } else {
      skipExplorePair = false;
    }
    cleaned.push(m);
  }

  if (removedCount > 0) {
    deps.loopState.messages = cleaned;
    deps.loopState.messages.push({
      role: 'user',
      content: renderFragment(
        createFragment({
          kind: 'system',
          text: '请以最新一条用户消息为准重新规划当前任务；之前工具循环中未完成的工作仅在与最新消息直接相关时继续，否则忽略，不要重复执行旧任务步骤。',
        })
      ),
      [FRAGMENT_KIND_FIELD]: 'system',
    });
    logger.info('reactToolLoop:new_task_sanitized', {
      sessionId: deps.sessionId,
      removedCount,
      remainingMessages: deps.loopState.messages.length,
    });
  }
}
