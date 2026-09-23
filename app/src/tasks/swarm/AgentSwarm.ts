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
 *
 * 2026-09-21 契约修订（O12-2）：
 *   - `SwarmExecutorParams.tools` 由**必填改为可选**，并明确语义为「工具**类别**清单」
 *     （`toolCategories.ts` 的 `ToolCategory`，如 `search` / `file_read`；**不是**工具名）：
 *     worker 调用携带 `['search','file_read']`（只读检索，与 worker 提示词的
 *     "只读操作，不修改任何文件"一致）；verifier / synthesizer 调用**不携带**
 *     （其产物是 JSON 结论/汇总报告，输入已由 worker 输出提供，注入工具只增加非确定性）。
 *   - 修正原声明值 `['search','file']`：其中 `'file'` 是**写入**类别，与只读契约自相矛盾。
 *   - 此前该字段**从未被适配器消费**（`AgentTool.buildSwarmExecutor` 恒传 `tools: []` 给引擎）
 *     ⇒ worker 连只读检索都不可用；现按类别过滤后真正注入。
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

/** verifier 门禁三态（O4） */
export type SwarmVerifyState = 'passed' | 'failed' | 'skipped';

/**
 * 默认并发上限（同时最多投递的 worker 数）。
 *
 * R2 修正（2026-09-22）：导出为**单一真源** —— `AgentTool` 的"准入即预留"需按
 * **批次真实并发占用**（`min(任务数, 本并发上限)`）折算，不能在 AgentTool 里硬编码 3。
 */
export const DEFAULT_SWARM_CONCURRENCY = 3;

/** 单个 worker 执行结果 */
export interface SwarmWorkerResult {
  id: string;
  description: string;
  output: string;
  /** 该 worker 是否执行成功（**由 executor 的真实结果判定**，而非"有没有抛错"） */
  success: boolean;
  /** 是否因整体超时终止（O4：`ok` 的正向合取项） */
  timedOut: boolean;
  /**
   * verifier 门禁结论（O4 三态）：
   * - `passed`：verifier 明确判过；
   * - `failed`：明确判不过，**或 verifier 无法给出可解析结论**（fail-closed），**或 verifier 自身抛错**；
   * - `skipped`：未启用门禁（`enableVerify === false`）或该 worker 根本没跑起来。
   *
   * ⚠ 语义变更：原 `verified: boolean` 在"未启用/降级"时恒 `true`（fail-open）——
   * 无法区分"验证通过"与"压根没验证"。
   */
  verify: SwarmVerifyState;
  /** verifier 反馈（`failed` 时必带原因） */
  feedback?: string;
  /**
   * O4 正向合取：`success ∧ verify ≠ failed ∧ ¬timedOut`（在门禁阶段结束后统一计算）。
   * `allPassed` 以此为准 —— 原实现只看 `verified`，worker 执行失败时仍可能给出 `allPassed: true`。
   */
  ok: boolean;
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
  /**
   * 允许注入的工具**类别**清单（`toolCategories.ts` 的 `ToolCategory`，如 `search` /
   * `file_read`；**不是**工具名 —— 工具名形如 `grep` / `file_read`，类别形如 `search`）。
   *
   * - **worker 调用**携带（当前 `['search','file_read']`：只读检索能力）；
   * - **verifier / synthesizer 调用缺省** ⇒ 不注入工具（见文件头 O12-2 说明）。
   */
  tools?: string[];
  /**
   * 隔离环境（可选）。只有真正消费工作目录隔离的 executor 才需要它；
   * 缺省表示调用方不需要隔离 —— `createAgentIsolation()` 会同步创建
   * `~/.pyapp/workspaces/<id>` 且其清理默认不删目录，不允许隔离就不得传入。
   */
  isolation?: AgentIsolation;
  /** 期望的子代理类型：worker 取任务自身类型；verifier/synthesizer 为固定类型 */
  agentType?: string;
  /**
   * O6⑥：该次调用的**子任务标识**（仅 worker 调用携带；verifier/synthesizer 为空）。
   *
   * 供 executor 适配器按"批次 + 子任务"逐条落盘运行台账 —— 并行批次中途崩溃时，
   * 已完成的 worker 有真实记录，只有未完成的那几个是"未知"，而非**整批**未知。
   */
  taskKey?: string;
}

/** swarm executor 的返回（O4：携带**真实成败**与超时标记，不再只回文本） */
export interface SwarmExecutorResult {
  /** worker 输出文本 */
  output: string;
  /** 执行是否成功（由底层引擎的真实结果判定） */
  ok: boolean;
  /** 是否因整体超时终止（`ok` 的正向合取项，缺省视为未超时） */
  timedOut?: boolean;
  /**
   * worker 的**真实 token 用量**（M-8 接线，2026-09-22）。
   *
   * 用途：把长程任务的用量喂给 `TaskGoalStore`（任务级预算）。
   * 缺省/未提供 ⇒ 记 0（**不臆测**：宁可少记，不可编造用量）。
   */
  tokens?: number;
}

/** swarm executor（只读调用，返回 `{ output, ok, timedOut? }`） */
export interface SwarmExecutor {
  (params: SwarmExecutorParams): Promise<SwarmExecutorResult>;
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
  /**
   * 是否全部 worker 均 `ok`（O4 正向合取：`success ∧ verify ≠ failed ∧ ¬timedOut`）。
   *
   * **基数守卫**：空批次（`workers.length === 0`）返回 `false` —— `[].every(...) === true`
   * 会让"一个 worker 都没跑"被判为全通过（出口⑥：signal 已中止时 `runBatched` 直接 return）。
   */
  allPassed: boolean;
  /** 批次是否因外部信号中止（`runBatched` 短路，未投递的任务既没跑也没失败） */
  cancelled?: boolean;
  /**
   * **请求了门禁、却有成功 worker 未拿到门禁结论**（2026-09-22 新增）。
   *
   * 触发场景：worker 阶段全部跑完后用户点停止 ⇒ `:310` 的前置条件 `!signal?.aborted` 为假
   * ⇒ 门禁**整批不启动** ⇒ 成功 worker 的 `verify` 停在初值 `'skipped'`。
   * 该事实必须显式暴露：调用方据此判定"门禁未完成"，而不与"未请求门禁"混为一谈。
   */
  verifyIncomplete?: boolean;
  /**
   * **worker 真实 token 用量合计**（M-8 接线，2026-09-22）。
   *
   * 口径：只累计 worker 返回的 `tokens`（executor 未提供 ⇒ 记 0，**不估算**）；
   * 不含 verifier / synthesizer（它们是门禁与汇总，不计入"任务工作量"）。
   * 用途：喂给 `TaskGoalStore` 的任务级预算（触顶 ⇒ `budget_limited`）。
   */
  totalTokens: number;
}

/**
 * 解析 verifier 输出（**fail-closed**，O4）
 *
 * 原实现为 **fail-open**：未找到 JSON 块 ⇒ `pass: true`；JSON 解析失败 ⇒ `pass: true`
 * ⇒ verifier 拒答 / 被打断 / 输出被截断时门禁**静默放行**，形同虚设。
 * 现改为"**无法确证通过 ⇒ 判不过**"，并写明原因（供上层展示与排障）。
 */
function parseVerifyOutput(text: string): SwarmVerifyResult {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    return {
      pass: false,
      feedback:
        'verifier 未返回可解析的门禁结论（输出中未找到 JSON）⇒ 按 fail-closed 判不过',
    };
  }
  try {
    const parsed = JSON.parse(match[0]) as {
      pass?: boolean;
      feedback?: string;
    };
    if (typeof parsed.pass !== 'boolean') {
      return {
        pass: false,
        feedback:
          'verifier 结论缺少布尔字段 pass ⇒ 按 fail-closed 判不过（原实现缺失即视为通过）',
      };
    }
    return { pass: parsed.pass, feedback: parsed.feedback };
  } catch {
    return {
      pass: false,
      feedback: 'verifier 输出的 JSON 无法解析 ⇒ 按 fail-closed 判不过',
    };
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
    const concurrency = options.maxConcurrency ?? DEFAULT_SWARM_CONCURRENCY;

    // 黑板：总目标 + 子任务清单（注入每个 worker）
    const blackboard = [
      `总目标: ${goal}`,
      `子任务清单:\n${tasks.map((t) => `- ${t.id}: ${t.description}`).join('\n')}`,
    ].join('\n');

    // M-13（2026-09-22）：worker 结果**按 task 索引落位**（原为"完成顺序 push"）。
    // 完成顺序与 `tasks` 顺序无关 ⇒ 任何"按下标取 worker"的调用方都会错配
    //（`AgentTool.runSwarmPath` 原先正靠下标兜底）；改为索引落位后，顺序 = task 顺序，
    // 未产出 worker 的任务（如批次取消）**不占位**（压实后缺位即缺席，可被识别）。
    const slots: Array<SwarmWorkerResult | undefined> = new Array(tasks.length);
    const workerErrors: string[] = [];
    /** M-8：worker 真实用量汇总（缺省 0，不臆测） */
    let workerTokens = 0;

    await runBatched(
      tasks.map((task, idx) => ({ task, idx })),
      concurrency,
      async ({ task, idx }) => {
        try {
          const res = await executor({
            systemPrompt:
              '你是多代理 swarm 中的一个 worker。只负责完成分配的子任务。输出你的执行结果（可为文本/摘要/JSON）。只读操作，不修改任何文件。',
            userPrompt: `${blackboard}\n\n你的子任务: ${task.description}`,
            // O12-2：只读检索类别（原 `'file'` 属**写入**类别，与上方提示词的"只读操作"矛盾）
            tools: ['search', 'file_read'],
            isolation,
            agentType: task.agentType,
            // O6⑥：worker 调用携带子任务标识 ⇒ 适配器可逐任务落盘
            taskKey: task.id,
          });
          const timedOut = res.timedOut === true;
          // M-8：累计 worker 真实用量（未提供 ⇒ 记 0；不做任何估算）
          const tokensThisRun = res.tokens ?? 0;
          if (Number.isFinite(tokensThisRun) && tokensThisRun > 0) {
            workerTokens += tokensThisRun;
          }
          slots[idx] = {
            id: task.id,
            description: task.description,
            output: res.output,
            // O4：成败取自 executor 的**真实结果**（原实现"未抛错即成功" ⇒
            // 引擎返回 completed=false（超时/截断/中止）也被记为成功）
            success: res.ok && !timedOut,
            timedOut,
            verify: 'skipped', // 门禁阶段回填（未启用门禁则保持 skipped）
            ok: false, // 门禁阶段结束后统一按正向合取计算
            ...(res.ok
              ? {}
              : { feedback: '执行未成功（引擎真实结果为未完成）' }),
          };
        } catch (err) {
          workerErrors.push(`${task.id}: ${String(err)}`);
          slots[idx] = {
            id: task.id,
            description: task.description,
            output: '',
            success: false,
            timedOut: false,
            verify: 'skipped',
            ok: false,
            feedback: `执行失败: ${String(err)}`,
          };
        }
      },
      signal
    );

    // M-13：压实索引槽位 ⇒ `workerResults` 顺序 = **task 顺序**（未产出 worker 的任务缺席）
    const workerResults: SwarmWorkerResult[] = slots.filter(
      (r): r is SwarmWorkerResult => r !== undefined
    );

    // verifier 门禁：逐 worker 验证（仅对成功 worker）
    if (options.enableVerify !== false && !signal?.aborted) {
      await runBatched(
        workerResults.filter((r) => r.success),
        concurrency,
        async (r) => {
          try {
            const verifyRes = await executor({
              systemPrompt:
                '你是 swarm 的 verifier。审查 worker 输出是否完成其子任务。输出 JSON：{"pass":bool,"feedback":"说明"}。只读操作。',
              userPrompt: `子任务: ${r.description}\n\nworker 输出:\n${r.output}`,
              isolation,
              agentType: 'verification',
            });
            const v = parseVerifyOutput(verifyRes.output);
            r.verify = v.pass ? 'passed' : 'failed';
            r.feedback = v.feedback;
          } catch (err) {
            // O4 fail-closed：verifier 自身失败 ⇒ 该 worker **判不过**
            // （原实现保持 verified=true 并记一条 warn，"跳过门禁"等价于放行）
            r.verify = 'failed';
            r.feedback = `verifier 执行失败（fail-closed 判不过）：${String(err)}`;
            logger.warn('swarm verifier 失败 ⇒ fail-closed 判不过', {
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
        synthesized = (
          await executor({
            systemPrompt:
              '你是 swarm 的 synthesizer。汇总所有 worker 的结果，输出一份统一的最终报告（合并重复、标注冲突、给出结论）。只读操作。',
            userPrompt: `${blackboard}\n\nworker 结果汇总:\n${summary}`,
            isolation,
            agentType: 'general',
          })
        ).output;
      } catch (err) {
        logger.warn('swarm synthesizer 失败（跳过合成）', {
          error: String(err),
        });
      }
    }

    if (workerErrors.length > 0) {
      logger.warn('swarm worker 存在失败', { errors: workerErrors });
    }

    // O4：正向合取（`ok = 执行成功 ∧ 门禁通过 ∧ 未超时`）+ **门禁三态**（2026-09-22 修复）
    //
    // 修复的洞：门禁阶段前置条件为 `enableVerify !== false && !signal?.aborted`（本文件 :310），
    // 若取消发生在「worker 全部跑完、门禁尚未开始」⇒ 门禁**整批不启动**，成功 worker 的
    // `verify` 停在初值 `'skipped'`；而旧判据 `verify !== 'failed'` 让 `'skipped'` 直接通过
    // ⇒ **调用方显式传了 `verify:true`，门禁一次都没跑，却被报成"全部通过"**。
    // （`allPassed` 的基数守卫只挡住"空数组 `every()`"，挡不住"非空数组 + 门禁未执行"。）
    //
    // 现语义：**请求了门禁却没拿到结论 ⇒ 该 worker 不得判通过**（fail-closed，与 O4 同源）；
    //         仅当调用方**未请求**门禁时，`'skipped'` 才视为通过（本就无门禁可跑）。
    const verifyRequested = options.enableVerify !== false;
    const verifyIncomplete =
      verifyRequested &&
      workerResults.some((r) => r.success && r.verify === 'skipped');
    for (const r of workerResults) {
      const gateOk = !verifyRequested || r.verify === 'passed';
      r.ok = r.success && gateOk && !r.timedOut;
    }

    return {
      workers: workerResults,
      synthesized,
      // O4：`allPassed` 语义收紧为"每个 worker 都 `ok`" ——
      // 原实现只看 `verified`，而失败 worker 的 `verified` 初值即为 true
      // ⇒ 存在"worker 全失败却 allPassed: true"的假阳性
      // 基数守卫：空批次不得判为全通过（`[].every(...) === true`）
      allPassed: workerResults.length > 0 && workerResults.every((r) => r.ok),
      // 出口⑥：批次中止时剩余任务从未投递，调用方需能与"全部执行失败"区分
      cancelled: signal?.aborted === true,
      // 门禁未完成的事实（调用方据此归因，不与"未请求门禁"混淆）
      verifyIncomplete,
      // M-8：worker 真实用量合计（未提供 ⇒ 0）
      totalTokens: workerTokens,
    };
  }
}
