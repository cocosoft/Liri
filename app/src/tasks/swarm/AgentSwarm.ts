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
 */

import { getLogger } from '@modules/monitoring';
import type { AgentIsolation } from '@modules/agent';
import type { GoalEvaluateExecutor } from '../review/GoalEvaluateGate';

const logger = getLogger('tasks:agentSwarm');

/** swarm 子任务（worker） */
export interface SwarmWorkerTask {
  id: string;
  description: string;
}

/** 单个 worker 执行结果 */
export interface SwarmWorkerResult {
  id: string;
  description: string;
  output: string;
  /** verifier 门禁是否通过（未启用/降级时为 true） */
  verified: boolean;
  feedback?: string;
}

/** verifier 门禁结果 */
export interface SwarmVerifyResult {
  pass: boolean;
  feedback?: string;
}

/** swarm 运行配置 */
export interface AgentSwarmOptions {
  /** 子任务列表（并行 workers） */
  tasks: SwarmWorkerTask[];
  /** 总目标（黑板共享上下文） */
  goal: string;
  executor: GoalEvaluateExecutor;
  isolation: AgentIsolation;
  /** 最大并发数（默认 3） */
  maxConcurrency?: number;
  /** 是否启用 verifier 门禁（默认 true） */
  enableVerify?: boolean;
  /** 是否启用 synthesizer 合成（默认 true） */
  enableSynthesize?: boolean;
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

/** 分批执行（限流并发） */
async function runBatched<T>(
  items: T[],
  batchSize: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    await Promise.all(items.slice(i, i + batchSize).map(fn));
  }
}

/**
 * 多代理 swarm 编排器（无状态，可复用单例）
 */
export class AgentSwarm {
  async run(options: AgentSwarmOptions): Promise<AgentSwarmResult> {
    const { tasks, goal, executor, isolation } = options;
    const concurrency = options.maxConcurrency ?? 3;

    // 黑板：总目标 + 子任务清单（注入每个 worker）
    const blackboard = [
      `总目标: ${goal}`,
      `子任务清单:\n${tasks.map((t) => `- ${t.id}: ${t.description}`).join('\n')}`,
    ].join('\n');

    const workerResults: SwarmWorkerResult[] = [];
    const workerErrors: string[] = [];

    await runBatched(tasks, concurrency, async (task) => {
      try {
        const output = await executor({
          systemPrompt:
            '你是多代理 swarm 中的一个 worker。只负责完成分配的子任务。输出你的执行结果（可为文本/摘要/JSON）。只读操作，不修改任何文件。',
          userPrompt: `${blackboard}\n\n你的子任务: ${task.description}`,
          tools: ['search', 'file'],
          isolation,
        });
        workerResults.push({
          id: task.id,
          description: task.description,
          output,
          verified: true,
        });
      } catch (err) {
        workerErrors.push(`${task.id}: ${String(err)}`);
        workerResults.push({
          id: task.id,
          description: task.description,
          output: '',
          verified: false,
          feedback: `执行失败: ${String(err)}`,
        });
      }
    });

    // verifier 门禁：逐 worker 验证（仅对成功 worker）
    if (options.enableVerify !== false) {
      await runBatched(
        workerResults.filter((r) => r.verified),
        concurrency,
        async (r) => {
          try {
            const text = await executor({
              systemPrompt:
                '你是 swarm 的 verifier。审查 worker 输出是否完成其子任务。输出 JSON：{"pass":bool,"feedback":"说明"}。只读操作。',
              userPrompt: `子任务: ${r.description}\n\nworker 输出:\n${r.output}`,
              tools: ['search', 'file'],
              isolation,
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
        }
      );
    }

    // synthesizer：汇总全部结果 → 合成最终输出
    let synthesized = '';
    if (options.enableSynthesize !== false && workerResults.length > 0) {
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
