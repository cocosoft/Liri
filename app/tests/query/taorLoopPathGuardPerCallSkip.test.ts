/**
 * B14 回归（2026-10-07，`.trae/specs/runtime-ast-guardrail-assessment.md` §3）：
 * **TAORLoop.act() 的 PathGuard 粒度 = 按调用跳过**（对齐 `ReActToolLoop.act()`）。
 *
 * 修复前：PathGuard 命中即进 `blocked` ⇒ **整批丢弃 + 整轮终止**（`act()` 返回 `results: []`），
 * 模型再无机会改用其它路径（与本会话已修的 ReAct 侧 BUG 同源，属同族漂移）。
 * 修复后：仅该调用不执行，并在**原位回填失败结果**（PAIR-FILL，保住 `rawResults[i] ↔ calls[i]`），
 * 同批其余照常执行、**本轮继续**。
 *
 * ⚠️ 边界：**循环检测 critical / 文件 IO 两类仍整批终止**（有意语义）—— 本用例不覆盖，故此处
 * 只断言"PathGuard 一路"的粒度。
 *
 * MIT License - Copyright (c) 2026 190615273@qq.com
 */
import { describe, expect, it } from 'bun:test';
import { TAORLoop } from '../../src/query/TAORLoop';
import type { QueryEngine } from '../../src/query/QueryEngine';

/** 测试可访问的私有成员（沿用本目录既有 Testable 写法，避免 `any`） */
interface ActResult {
  results: Array<{
    toolCallId: string;
    name: string;
    status: string;
    error?: string;
  }>;
  allSucceeded: boolean;
  anyAborted: boolean;
}

interface TestableLoop {
  deps: {
    executeTools: (
      calls: Array<{ id: string; name: string; arguments: unknown }>,
      signal: AbortSignal
    ) => Promise<
      Array<{
        toolCallId?: string;
        toolName?: string;
        result?: unknown;
        error?: string;
      }>
    >;
  };
  pathGuard: {
    checkToolCall(
      name: string,
      input: unknown
    ): { allowed: boolean; reason?: string };
  };
  messages: Array<{ role: string; tool_call_id?: string; content?: string }>;
  act(
    calls: Array<{ id: string; name: string; input: unknown }>
  ): AsyncGenerator<unknown, ActResult>;
}

function makeLoop(): TestableLoop {
  return new TAORLoop({} as unknown as QueryEngine) as unknown as TestableLoop;
}

/** 消费异步生成器并取回其**返回值**（`for await` 会丢弃返回值） */
async function drain(
  gen: AsyncGenerator<unknown, ActResult>
): Promise<ActResult> {
  for (;;) {
    const r = await gen.next();
    if (r.done) return r.value;
  }
}

describe('B14: TAORLoop PathGuard 按调用跳过（不再整批终止）', () => {
  it('命中者不执行且原位回填失败结果；同批其余照常执行、本轮继续', async () => {
    const loop = makeLoop();
    const executedIds: string[] = [];
    loop.deps = {
      executeTools: async (calls) => {
        executedIds.push(...calls.map((c) => c.id));
        return calls.map((c) => ({
          toolCallId: c.id,
          toolName: c.name,
          result: { ok: true },
        }));
      },
    };
    // 仅 `file_read` 命中（模拟命中 `.env` 拒绝列表）
    loop.pathGuard = {
      checkToolCall: (name) =>
        name === 'file_read'
          ? {
              allowed: false,
              reason: '路径 "x/.env" 命中拒绝列表 (read: **/.env)',
            }
          : { allowed: true },
    };

    const calls = [
      { id: 'c1', name: 'file_list', input: {} },
      { id: 'c2', name: 'file_read', input: { file_path: 'x/.env' } },
      { id: 'c3', name: 'file_write', input: {} },
    ];
    const actResult = await drain(loop.act(calls));

    // ① 命中者**未被交给执行器**（护栏未放宽）
    expect(executedIds).toEqual(['c1', 'c3']);
    // ② 本轮**未终止**：results 与 calls 等长、且顺序对齐（修复前恒为 `[]`）
    expect(actResult.results.map((r) => r.toolCallId)).toEqual([
      'c1',
      'c2',
      'c3',
    ]);
    expect(actResult.results[0].status).toBe('success');
    expect(actResult.results[1].status).toBe('error');
    expect(actResult.results[1].error).toContain('安全护栏');
    expect(actResult.results[2].status).toBe('success');
    // ③ 配对完整（PAIR-FILL）：三条 tool 消息与 tool_call_id 一一对应
    const toolMsgs = loop.messages.filter((m) => m.role === 'tool');
    expect(toolMsgs.map((m) => m.tool_call_id)).toEqual(['c1', 'c2', 'c3']);
    expect(toolMsgs[1].content).toContain('安全护栏');
  });

  it('无命中 ⇒ 全部照常执行（零行为变更）', async () => {
    const loop = makeLoop();
    const executedIds: string[] = [];
    loop.deps = {
      executeTools: async (calls) => {
        executedIds.push(...calls.map((c) => c.id));
        return calls.map((c) => ({
          toolCallId: c.id,
          toolName: c.name,
          result: 1,
        }));
      },
    };
    loop.pathGuard = { checkToolCall: () => ({ allowed: true }) };
    const calls = [
      { id: 'c1', name: 'file_list', input: {} },
      { id: 'c2', name: 'file_read', input: { file_path: 'ok.ts' } },
    ];
    const actResult = await drain(loop.act(calls));

    expect(executedIds).toEqual(['c1', 'c2']);
    expect(actResult.results.map((r) => r.toolCallId)).toEqual(['c1', 'c2']);
    expect(actResult.allSucceeded).toBe(true);
  });
});
