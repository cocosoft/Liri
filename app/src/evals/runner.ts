// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 评测执行器（D2 骨架）
 *
 * 每次尝试：清空工作区 → 新建独立会话 → 流式跑一次 Agent（真实模型）→ 按 L1 断言读环境终态。
 * 指标：`pass^1`（符合预期率）与 `pass^k`（k 次全部符合预期）—— 后者才是可用性门槛（τ-bench 做法）。
 */

import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { EvalSandbox } from './sandbox.js';
import type {
  AssertResult,
  EvalAttempt,
  EvalContext,
  EvalTask,
  EvalTaskResult,
  ToolCallRecord,
} from './types.js';
import {
  extractToolCalls,
  toolCallNames,
  buildToolCallsDetail,
} from './trace.js';
import { computeBehaviorMetrics } from './behaviorMetrics.js';
import {
  forEachAttemptSandbox,
  type SandboxStrategy,
} from './sandboxStrategy.js';
import { isAsExpected, summarizeTask } from './scoring.js';
import { withRetry, RetryableError } from '@modules/utils/withRetry';
import { evaluateProcessRules } from './processAssertions';

/** 一次流式对话的结果 */
interface StreamOutcome {
  sessionId: string;
  text: string;
  promptTokens?: number;
  completionTokens?: number;
  /** 本次发生的工具调用序列（L2 断言用；从持久化消息读取） */
  toolCalls: ToolCallRecord[];
}

/** 建会话 */
async function createSession(baseUrl: string, title: string): Promise<string> {
  const res = await fetch(`${baseUrl}/v1/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`创建会话失败：HTTP ${res.status}`);
  }
  const body = (await res.json()) as Record<string, unknown>;
  const id = String(
    body.id ?? (body.session as Record<string, unknown> | undefined)?.id ?? ''
  );
  if (!id) throw new Error(`创建会话响应缺少 id：${JSON.stringify(body)}`);
  return id;
}

/**
 * 读取会话持久化消息，抽取**工具调用序列**（L2 断言用）。
 *
 * 刻意不解析 SSE 增量：按 §1.6 Write-Ahead Persistence，助手消息在流结束前已落盘，
 * 从盘读得到的是**最终序列**（含全部轮次与重试），比增量更可靠。
 * 读取失败不抛错 —— L2 断言会因序列为空而失败（可见），而不是把整轮评测打成异常。
 */
async function fetchToolCalls(
  baseUrl: string,
  sessionId: string
): Promise<ToolCallRecord[]> {
  try {
    const res = await fetch(
      `${baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}/messages`,
      { signal: AbortSignal.timeout(20_000) }
    );
    if (!res.ok) return [];
    return extractToolCalls(await res.json());
  } catch {
    // @ignore-catch —— 见上方注释：失败会让 L2 断言以"序列为空"失败，属可观测降级
    return [];
  }
}

/** 跑一次流式对话，收集文本与用量（导出供取流契约回归测试使用） */
export async function streamChat(
  baseUrl: string,
  sessionId: string,
  model: string,
  prompt: string,
  timeoutMs: number
): Promise<StreamOutcome> {
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      stream: true,
      session_id: sessionId,
      model,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok || !res.body) {
    throw new Error(`对话请求失败：HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let text = '';
  let promptTokens: number | undefined;
  let completionTokens: number | undefined;

  // O43 次生项加固（2026-09-13）：`[DONE]` 是 SSE 的"流已结束"契约，收到即应停止取流。
  // 此前只 `continue` 不退出 → 后端若发完终止标记却不关连接，这里会一直读到期超时，
  // 表现为"评测挂住"（与真实根因 O43 叠加时无法区分，故单独加固）。
  let sawDone = false;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') {
        sawDone = true;
        continue;
      }
      if (!payload) continue;
      let chunk: Record<string, unknown>;
      try {
        chunk = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        continue;
      }
      const delta = (
        chunk.choices as Array<{ delta?: { content?: string } }> | undefined
      )?.[0]?.delta;
      if (delta?.content) text += delta.content;
      const usage = chunk.usage as
        | { prompt_tokens?: number; completion_tokens?: number }
        | undefined;
      if (usage) {
        promptTokens = usage.prompt_tokens;
        completionTokens = usage.completion_tokens;
      }
    }
    // 批次处理完再退出：usage 分片写在 `[DONE]` **之前**（chat-handlers.ts:826 → :843），
    // 同批解析完毕即不会丢用量。
    if (sawDone) break;
  }

  if (sawDone) {
    // @ignore-catch — 服务端可能已关闭连接，取消剩余读取失败不影响已取到的结果
    await reader.cancel().catch(() => {});
  }

  const toolCalls = await fetchToolCalls(baseUrl, sessionId);
  return { sessionId, text, promptTokens, completionTokens, toolCalls };
}

/** 带超时执行断言 */
async function runAssert(
  task: EvalTask,
  ctx: EvalContext,
  timeoutMs: number
): Promise<AssertResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task.assert(ctx),
      new Promise<AssertResult>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`断言超时（${timeoutMs}ms）`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 跑单个任务的 k 次尝试。
 *
 * A3-a（2026-09-26）：沙箱改由 {@link SandboxStrategy} 提供 —— `shared` 时全部 attempt 复用
 * 同一实例（行为与改造前一致），`fresh` 时**每个 attempt 重建并在结束后销毁**
 * （`--repeat-fresh=<n>`）。
 */
export async function runTask(
  task: EvalTask,
  strategy: SandboxStrategy,
  opts: {
    k: number;
    model: string;
    timeoutOverrideMs?: number;
    retryOnInfra?: number;
  }
): Promise<EvalTaskResult> {
  const attempts = await forEachAttemptSandbox(
    strategy,
    opts.k,
    async (sandbox, index) =>
      runAttemptWithInfraRetry(
        `${task.id} #${index}`,
        () => runAttempt(task, sandbox, index, opts),
        opts.retryOnInfra ?? 0
      )
  );
  return summarizeTask(task, attempts);
}

/**
 * 本次 attempt 的**基建失败**信号：把"结果级失败"翻译成 `withRetry` 能识别的失败。
 * 仅在本模块内使用（不外抛）—— 重试额度耗尽时返回**真实 attempt**，见 {@link runAttemptWithInfraRetry}。
 */
class InfraAttemptError extends RetryableError {}

/**
 * 2026-09-26：`--retry-on-infra`（基建重试）—— 执行异常时**额外**重跑本次 attempt，
 * **不消耗 attempt 额度**（`--k` 语义不变）。
 *
 * **为什么需要**：模型/供应商会**停摆**（本仓实测 `deepseek-v4-flash` 约 2/9 请求 180s 无首字节）。
 * 停摆若被记成失败会**污染 `pass^1`**（把基建问题算成能力问题 ⇒ 定基线时给出错误阈值）。
 *
 * **只对 `failureKind === 'infra'` 放行**；`'assert'`（模型答错 / 未交付）是**能力信号**，绝不重试；
 * 缺省 / 未知取值一律不重试（fail-closed）。
 *
 * **实现约束（R01-003）**：重试统一走 `utils/withRetry`（禁止自建 for/while 重试循环）。
 * 本函数只做翻译与计数：把"本次 attempt **结果**为基建失败"抛给 `withRetry` 触发重试；
 * 额度用尽时**原样返回最后一次真实 attempt**（不伪造成功、不失真为异常）。
 */
export async function runAttemptWithInfraRetry(
  label: string,
  runOnce: () => Promise<EvalAttempt>,
  maxInfraRetries: number
): Promise<EvalAttempt> {
  const limit = Math.max(0, Math.floor(maxInfraRetries));
  /** 实际调用次数（含首次）；**重试次数 = 调用次数 - 1** */
  let invocations = 0;

  const attempt = await withRetry(
    async () => {
      invocations += 1;
      const current = await runOnce();
      // 非基建失败（能力信号）或额度已用尽 ⇒ 原样返回（后者即"最后一次真实 attempt"）
      if (current.failureKind !== 'infra' || invocations > limit)
        return current;
      process.stdout.write(
        `    · ${label}: 基建失败（${current.error ?? '执行异常'}）⇒ 重试 ${invocations}/${limit}（**不计入 attempt**）\n`
      );
      throw new InfraAttemptError(current.error ?? '执行异常');
    },
    // 基建停摆（挂死的请求）无需长退避，但保留标准退避语义：0.5s 起、上限 5s
    {
      maxRetries: limit,
      initialDelayMs: 500,
      backoffMultiplier: 2,
      maxDelayMs: 5_000,
    }
  );

  return invocations > 1
    ? { ...attempt, infraRetries: invocations - 1 }
    : attempt;
}

/** 单次尝试（沙箱由 {@link forEachAttemptSandbox} 按策略提供 —— 本函数不创建也不销毁） */
async function runAttempt(
  task: EvalTask,
  sandbox: EvalSandbox,
  index: number,
  opts: { model: string; timeoutOverrideMs?: number }
): Promise<EvalAttempt> {
  const startedAt = Date.now();
  /**
   * 2026-09-26：`timeoutOverrideMs`（CLI `--task-timeout-ms=<n>`）= **等待上限覆盖**。
   *
   * 用途：某些模型/供应商**停摆率**高（本仓实测 `deepseek-v4-flash` 约 2/9 请求 180s 无首字节），
   * 若每题都空等 180s，k 大的复测要跑数小时。缩短上限只让"**基建超时**"更快暴露
   * （超时在判定里记为执行异常、与能力无关），**不改变任何任务判据**。
   * 取值建议 ≥ 已观测到的**最长合法尝试**耗时（本仓实测 62.4s）留 2× 余量。
   */
  const timeoutMs = opts.timeoutOverrideMs ?? task.timeoutMs ?? 180_000;
  // 每次尝试都从干净工作区开始（终态断言才可重复）
  rmSync(sandbox.workspace, { recursive: true, force: true });
  mkdirSync(join(sandbox.workspace, 'eval_out'), { recursive: true });

  let assertion: AssertResult;
  let promptTokens: number | undefined;
  let completionTokens: number | undefined;
  let error: string | undefined;
  /** 结构化失败种类（见 `EvalAttempt.failureKind`）：默认按"正常走完"处理，仅 catch 分支置 `infra` */
  let failureKind: 'infra' | 'assert' = 'assert';
  let finalText = '';
  let toolCalls: ToolCallRecord[] = [];

  try {
    await task.setup?.({
      workspace: sandbox.workspace,
      home: sandbox.home,
      dataDir: sandbox.dataDir,
    });
    const sessionId = await createSession(
      sandbox.baseUrl,
      `eval:${task.id}#${index}`
    );
    const outcome = await streamChat(
      sandbox.baseUrl,
      sessionId,
      opts.model,
      task.prompt(sandbox.workspace),
      timeoutMs
    );
    promptTokens = outcome.promptTokens;
    completionTokens = outcome.completionTokens;
    finalText = outcome.text;
    toolCalls = outcome.toolCalls;
    assertion = await runAssert(
      task,
      {
        workspace: sandbox.workspace,
        home: sandbox.home,
        dataDir: sandbox.dataDir,
        finalText: outcome.text,
        toolCalls: outcome.toolCalls,
        sessionId,
        model: opts.model,
      },
      timeoutMs
    );
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    // 2026-09-26：**结构化**标记为基建失败（供 `runAttemptWithInfraRetry` 判定，不做字符串匹配）
    failureKind = 'infra';
    // 补上下文（2026-09-13）：此前只报 "执行异常：The operation timed out."，不含模型/端点，
    // 遇到"端点不可达/模型 id 不被上游接受"时无法定位（本轮 k≥4 采集即卡在此处）。
    assertion = {
      pass: false,
      reason: `执行异常：${error}（模型=${opts.model} ｜ 后端=${sandbox.baseUrl}）`,
    };
  }

  const asExpected = isAsExpected(task, assertion);
  // A1（2026-09-26）：明细（含参数，逐值截断）⇒ 报告可离线重算，且是 A2（行为指标）/ S2（过程断言）的前置
  const toolCallsDetail = buildToolCallsDetail(toolCalls);
  const attempt: EvalAttempt = {
    index,
    assertion,
    asExpected,
    durationMs: Date.now() - startedAt,
    promptTokens,
    completionTokens,
    error,
    toolCalls: toolCallNames(toolCalls),
    toolCallsDetail,
    // A2（2026-09-26）：行为指标（**仅观测，不进 asExpected**，见方案 A2）
    behavior: computeBehaviorMetrics(toolCalls, finalText),
    finalText: finalText.slice(0, 2000),
    // 2026-09-26：失败种类（结构化；`infra` 可被 `--retry-on-infra` 重试）
    failureKind,
    // S2（2026-09-26）：过程断言（**仅观测，不进 asExpected**）—— 纯函数、只读上面的明细 ⇒ 可离线重算。
    // 屏蔽清单取**该任务声明**的 `shieldedPaths`（P-c 据此判定"是否尝试访问被屏蔽路径"）。
    processFindings: evaluateProcessRules(
      toolCallsDetail,
      task.shieldedPaths ?? []
    ),
  };
  process.stdout.write(
    `    · ${task.id} #${index}: ${asExpected ? 'OK' : 'MISMATCH'} ` +
      `(${assertion.pass ? '断言通过' : `断言未通过：${assertion.reason ?? ''}`})\n`
  );
  return attempt;
}
