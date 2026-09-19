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
import { extractToolCalls, toolCallNames } from './trace.js';
import { isAsExpected, summarizeTask } from './scoring.js';

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

/** 执行单个任务的 k 次尝试 */
export async function runTask(
  task: EvalTask,
  sandbox: EvalSandbox,
  opts: { k: number; model: string }
): Promise<EvalTaskResult> {
  const attempts: EvalAttempt[] = [];
  const timeoutMs = task.timeoutMs ?? 180_000;

  for (let i = 1; i <= opts.k; i++) {
    const startedAt = Date.now();
    // 每次尝试都从干净工作区开始（终态断言才可重复）
    rmSync(sandbox.workspace, { recursive: true, force: true });
    mkdirSync(join(sandbox.workspace, 'eval_out'), { recursive: true });

    let assertion: AssertResult;
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;
    let error: string | undefined;
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
        `eval:${task.id}#${i}`
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
      // 补上下文（2026-09-13）：此前只报 "执行异常：The operation timed out."，不含模型/端点，
      // 遇到"端点不可达/模型 id 不被上游接受"时无法定位（本轮 k≥4 采集即卡在此处）。
      assertion = {
        pass: false,
        reason: `执行异常：${error}（模型=${opts.model} ｜ 后端=${sandbox.baseUrl}）`,
      };
    }

    const asExpected = isAsExpected(task, assertion);
    attempts.push({
      index: i,
      assertion,
      asExpected,
      durationMs: Date.now() - startedAt,
      promptTokens,
      completionTokens,
      error,
      toolCalls: toolCallNames(toolCalls),
      finalText: finalText.slice(0, 2000),
    });
    process.stdout.write(
      `    · ${task.id} #${i}: ${asExpected ? 'OK' : 'MISMATCH'} ` +
        `(${assertion.pass ? '断言通过' : `断言未通过：${assertion.reason ?? ''}`})\n`
    );
  }

  return summarizeTask(task, attempts);
}
