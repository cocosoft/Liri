// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * AgentSwarm — 多代理并行编排（P1-6，对标 Hermes kanban_swarm create_swarm）
 *
 * 结构（对齐 Hermes root→parallel workers→verifier→synthesizer + 黑板）：
 *   1. 并行 workers：maxConcurrency 限流并发执行子任务（复用 ReviewGate 同构 executor）
 *   2. verifier 门禁：逐 worker 验证结果（pass/feedback）
 *   3. synthesizer：汇总全部 worker 结果 → 合成最终输出
 *   4. 黑板：总目标/子任务清单作为共享上下文注入每个 worker
 *
 * 降级：executor/verifier/synthesizer 失败均不阻断主流程（warn + 跳过对应环节），
 *       保证 swarm 是"增强能力"而非单点依赖。
 *
 * 2026-09-20 契约修订（B-4 接线前置，见 .trae/documents/B-4-并行入口接线Spec.md）：
 *   - executor 契约由 `GoalEvaluateExecutor` 扩展为本地 `SwarmExecutor`（新增可选 `agentType`），
 *     使调用方可为每个 worker 指定子代理类型（保住 `AgentTool.tasks[]` 原有的 per-task `subagent_type` 能力）；
 *   - `SwarmWorkerResult` 新增 `success`（真实成败），供调用方**不依赖字符串匹配**地还原既有汇总格式；
 *   - 新增 `signal?: AbortSignal`：批次间检查取消，并把取消语义交由调用方的 executor 适配器
 *     传给底层子代理（对齐 ParallelOrchestrator（B-4 已删除）abortAll 的 BUG 15 修复语义）；
 *   - 批次执行改用 `Promise.allSettled`（异常隔离对齐 ParallelOrchestrator（已删除）executeAll）；
 *   - `isolation` 由必填改为**可选**：仅当 executor 真正消费隔离资源时才传。
 *     `createAgentIsolation()` 会同步创建 `~/.pyapp/workspaces/<id>` 且 `cleanup()` 默认不删目录，
 *     调用方仅为满足类型而传入会导致空目录随调用无界累积。
 */

import { getLogger } from '@modules/monitoring';
import type { AgentIsolation } from '@modules/agent';

const logger = getLogger('tasks:agentSwarm');

/** swarm 子任务（worker） */
export interface SwarmWorkerTask {
  id: string;
  description: string;
  /** 该 worker 使用的子代理类型（可选；缺省由 executor 适配器决定，如 general） */
  agentType?: string;
}

/** 单个 worker 执行结果 */
export interface SwarmWorkerResult {
  id: string;
  description: string;
  output: string;
  /** 该 worker 是否执行成功（executor 未抛错即为 true；不看 verifier 结论） */
  success: boolean;
  /** verifier 门禁是否通过（未启用/降级时为 true） */
  verified: boolean;
  feedback?: string;
}

/** verifier 门禁结果 */
export interface SwarmVerifyResult {
  pass: boolean;
  feedback?: string;
}

/**
 * swarm executor 入参。
 * 与 `GoalEvaluateExecutor`（tasks/review/GoalEvaluateGate）同构，额外携带 `agentType`（可选）——
 * 因此既有的 GoalEvaluateExecutor 实现可直接传入（可选字段不破坏兼容）。
 */
export interface SwarmExecutorParams {
  systemPrompt: string;
  userPrompt: string;
  tools: string[];
  /**
   * 隔离环境（可选）。只有真正消费工作目录隔离的 executor 才需要它；
   * 缺省表示调用方不需要隔离 —— `createAgentIsolation()` 会同步创建
   * `~/.pyapp/workspaces/<id>` 且其清理默认不删目录，不允许隔离就不得传入。
   */
  isolation?: AgentIsolation;
  /** 期望的子代理类型：worker 取任务自身类型；verifier/synthesizer 为固定类型 */
  agentType?: string;
}

/** swarm executor（只读调用，返回文本） */
export interface SwarmExecutor {
  (params: SwarmExecutorParams): Promise<string>;
}

/** swarm 运行配置 */
export interface AgentSwarmOptions {
  /** 子任务列表（并行 workers） */
  tasks: SwarmWorkerTask[];
  /** 总目标（黑板共享上下文） */
  goal: string;
  executor: SwarmExecutor;
  /** 隔离环境（可选）：仅当 executor 需要工作目录隔离时才传入，缺省不创建任何目录 */
  isolation?: AgentIsolation;
  /** 最大并发数（默认 3） */
  maxConcurrency?: number;
  /** 是否启用 verifier 门禁（默认 true） */
  enableVerify?: boolean;
  /** 是否启用 synthesizer 合成（默认 true） */
  enableSynthesize?: boolean;
  /**
   * 外部取消信号。批次间检查：已取消则不再启动新批次；
   * 在途子任务的取消由 executor 适配器把该 signal 传给底层子代理执行器完成。
   */
  signal?: AbortSignal;
}

/** swarm 运行结果 */
export interface AgentSwarmResult {
  workers: SwarmWorkerResult[];
  /** synthesizer 合成输出（未启用/降级时为空串） */
  synthesized: string;
  /** 是否全部通过 verifier 门禁 */
  allPassed: boolean;
}

/** 解析 verifier 输出（容错：非 JSON 视为 pass） */
function parseVerifyOutput(text: string): SwarmVerifyResult {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { pass: true };
  try {
    const parsed = JSON.parse(match[0]) as {
      pass?: boolean;
      feedback?: string;
    };
    return { pass: parsed.pass !== false, feedback: parsed.feedback };
  } catch {
    return { pass: true };
  }
}

/**
 * 分批执行（限流并发 + 取消检查 + 异常隔离）
 *
 * 对齐 ParallelOrchestrator（B-4 已删除）executeAll 的两项既有保障：
 *   - `Promise.allSettled`：单个 batch 内任一 fn 抛出也不影响其它；
 *   - `signal`：批次间短路（在途取消由 executor 自行响应信号）。
 */
async function runBatched<T>(
  items: T[],
  batchSize: number,
  fn: (item: T) => Promise<void>,
  signal?: AbortSignal
): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    if (signal?.aborted) {
      logger.warn('swarm 批次执行已取消，剩余批次不再启动', {
        processed: i,
        total: items.length,
      });
      return;
    }
    await Promise.allSettled(items.slice(i, i + batchSize).map(fn));
  }
}

/**
 * 多代理 swarm 编排器（无状态，可复用单例）
 */
export class AgentSwarm {
  async run(options: AgentSwarmOptions): Promise<AgentSwarmResult> {
    const { tasks, goal, executor, isolation, signal } = options;
    const concurrency = options.maxConcurrency ?? 3;

    // 黑板：总目标 + 子任务清单（注入每个 worker）
    const blackboard = [
      `总目标: ${goal}`,
      `子任务清单:\n${tasks.map((t) => `- ${t.id}: ${t.description}`).join('\n')}`,
    ].join('\n');

    const workerResults: SwarmWorkerResult[] = [];
    const workerErrors: string[] = [];

    await runBatched(
      tasks,
      concurrency,
      async (task) => {
        try {
          const output = await executor({
            systemPrompt:
              '你是多代理 swarm 中的一个 worker。只负责完成分配的子任务。输出你的执行结果（可为文本/摘要/JSON）。只读操作，不修改任何文件。',
            userPrompt: `${blackboard}\n\n你的子任务: ${task.description}`,
            tools: ['search', 'file'],
            isolation,
            agentType: task.agentType,
          });
          workerResults.push({
            id: task.id,
            description: task.description,
            output,
            success: true,
            verified: true,
          });
        } catch (err) {
          workerErrors.push(`${task.id}: ${String(err)}`);
          workerResults.push({
            id: task.id,
            description: task.description,
            output: '',
            success: false,
            verified: false,
            feedback: `执行失败: ${String(err)}`,
          });
        }
      },
      signal
    );

    // verifier 门禁：逐 worker 验证（仅对成功 worker）
    if (options.enableVerify !== false && !signal?.aborted) {
      await runBatched(
        workerResults.filter((r) => r.success),
        concurrency,
        async (r) => {
          try {
            const text = await executor({
              systemPrompt:
                '你是 swarm 的 verifier。审查 worker 输出是否完成其子任务。输出 JSON：{"pass":bool,"feedback":"说明"}。只读操作。',
              userPrompt: `子任务: ${r.description}\n\nworker 输出:\n${r.output}`,
              tools: ['search', 'file'],
              isolation,
              agentType: 'verification',
            });
            const v = parseVerifyOutput(text);
            r.verified = v.pass;
            r.feedback = v.feedback;
          } catch (err) {
            logger.warn('swarm verifier 失败（跳过该 worker 门禁）', {
              taskId: r.id,
              error: String(err),
            });
          }
        },
        signal
      );
    }

    // synthesizer：汇总全部结果 → 合成最终输出
    let synthesized = '';
    if (
      options.enableSynthesize !== false &&
      workerResults.length > 0 &&
      !signal?.aborted
    ) {
      try {
        const summary = workerResults
          .map((r) => `[${r.id}] ${r.description}\n${r.output || '(无输出)'}`)
          .join('\n\n---\n\n');
        synthesized = await executor({
          systemPrompt:
            '你是 swarm 的 synthesizer。汇总所有 worker 的结果，输出一份统一的最终报告（合并重复、标注冲突、给出结论）。只读操作。',
          userPrompt: `${blackboard}\n\nworker 结果汇总:\n${summary}`,
          tools: ['search', 'file'],
          isolation,
          agentType: 'general',
        });
      } catch (err) {
        logger.warn('swarm synthesizer 失败（跳过合成）', {
          error: String(err),
        });
      }
    }

    if (workerErrors.length > 0) {
      logger.warn('swarm worker 存在失败', { errors: workerErrors });
    }

    return {
      workers: workerResults,
      synthesized,
      allPassed: workerResults.every((r) => r.verified),
    };
  }
}
