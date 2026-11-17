// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `tryHandleLocalQueryTool` 的特征化测试（2026-11-17，T3 复杂度清理，stage 1）。
 *
 * 背景：`get_tool_result` / `session_lookup` / `list_tool_calls` 三段原先内联在
 * `ToolExecutionService._executeInternal`（圈复杂度 149）入口处；搬出为不依赖 `this`
 * 的纯函数（`app/src/chat/services/localQueryTools.ts`）后直接单测。
 *
 * 钉住的行为：
 *  ① 非这三类工具 ⇒ `null`（调用方继续常规执行路径），且不触碰结果注册表；
 *  ② `get_tool_result` 命不命中都如实回报（`found` + `toolCallId` 透传）；
 *  ③ `session_lookup` 未注入 ⇒ `ok:false` + 可读错误；会话 id 回退注入的 currentSessionId；
 *     命中/失败分别产出 `content/nextFromSeq` 与 `error=reason`；
 *  ④ `list_tool_calls` 三条取数分支（round+session / session / 全量并截断 50）；
 *     `hasError` 由结果的 `error` 派生，`total` 为返回条数。
 */
import { afterEach, describe, expect, it, spyOn } from 'bun:test';

import { toolResultRegistry } from '@modules/tool/ToolResultRegistry.js';
import { tryHandleLocalQueryTool } from '../../src/chat/services/localQueryTools';

const spies: Array<{ mockRestore: () => void }> = [];

function stub<T extends object, K extends keyof T>(
  obj: T,
  key: K,
  impl: (...args: unknown[]) => unknown
) {
  const s = spyOn(obj as never, key as never).mockImplementation(impl as never);
  spies.push(s as unknown as { mockRestore: () => void });
  return s as unknown as { mock: { calls: unknown[][] } };
}

afterEach(() => {
  for (const s of spies.splice(0, spies.length)) s.mockRestore();
});

function stored(id: string, hasError = false) {
  return {
    toolCallId: id,
    toolName: 'bash',
    round: 1,
    timestamp: 1,
    result: hasError ? { error: 'boom' } : { ok: true },
  };
}

describe('tryHandleLocalQueryTool：本地查询工具短路（特征化）', () => {
  it('① 非本地查询工具 ⇒ null 且不触碰结果注册表', async () => {
    const find = stub(toolResultRegistry, 'findByCallId', () => undefined);
    const all = stub(toolResultRegistry, 'listAll', () => []);

    const result = await tryHandleLocalQueryTool(
      { id: 'call-1', name: 'bash', arguments: {} },
      {}
    );

    expect(result).toBeNull();
    expect(find.mock.calls).toHaveLength(0);
    expect(all.mock.calls).toHaveLength(0);
  });

  it('② get_tool_result：未命中 ⇒ found:false', async () => {
    stub(toolResultRegistry, 'findByCallId', () => undefined);

    const result = await tryHandleLocalQueryTool(
      {
        id: 'call-2',
        name: 'get_tool_result',
        arguments: { tool_call_id: 'x' },
      },
      {}
    );

    expect(result).toMatchObject({
      toolCallId: 'call-2',
      toolName: 'get_tool_result',
      result: { found: false, toolCallId: 'x' },
    });
  });

  it('② get_tool_result：命中 ⇒ 原样带回记录', async () => {
    stub(toolResultRegistry, 'findByCallId', () => stored('x'));

    const result = await tryHandleLocalQueryTool(
      {
        id: 'call-3',
        name: 'get_tool_result',
        arguments: { tool_call_id: 'x' },
      },
      {}
    );

    expect(result?.result).toMatchObject({ found: true });
  });

  it('③ session_lookup：未注入 ⇒ ok:false + 可读错误', async () => {
    const result = await tryHandleLocalQueryTool(
      { id: 'call-4', name: 'session_lookup', arguments: {} },
      {}
    );

    expect(result?.result).toMatchObject({ ok: false });
    expect(String((result?.result as { error?: string }).error)).toContain(
      '未在当前运行环境注册'
    );
  });

  it('③ session_lookup：会话 id 回退 currentSessionId；成功带回 content / nextFromSeq', async () => {
    const calls: unknown[][] = [];
    const result = await tryHandleLocalQueryTool(
      { id: 'call-5', name: 'session_lookup', arguments: { limit: 10 } },
      {
        currentSessionId: 'sess-9',
        sessionLookup: async (args) => {
          calls.push([args]);
          return { ok: true, content: 'CUT', nextFromSeq: 42 };
        },
      }
    );

    expect(calls[0]![0]).toMatchObject({ sessionId: 'sess-9', limit: 10 });
    expect(result?.result).toMatchObject({
      ok: true,
      content: 'CUT',
      nextFromSeq: 42,
    });
  });

  it('③ session_lookup：失败 ⇒ error 取 reason', async () => {
    const result = await tryHandleLocalQueryTool(
      { id: 'call-6', name: 'session_lookup', arguments: { sessionId: 's1' } },
      { sessionLookup: async () => ({ ok: false, reason: '区间无效' }) }
    );

    expect(result?.result).toMatchObject({ ok: false, error: '区间无效' });
  });

  it('④ list_tool_calls：round + session ⇒ 只取该轮', async () => {
    const byRound = stub(toolResultRegistry, 'listByRound', () => [
      stored('a'),
    ]);
    const bySession = stub(toolResultRegistry, 'listBySession', () => []);
    const all = stub(toolResultRegistry, 'listAll', () => []);

    const result = await tryHandleLocalQueryTool(
      {
        id: 'call-7',
        name: 'list_tool_calls',
        arguments: { round: 2, sessionId: 's1' },
      },
      {}
    );

    expect(byRound.mock.calls).toHaveLength(1);
    expect(byRound.mock.calls[0]).toEqual(['s1', 2]);
    expect(bySession.mock.calls).toHaveLength(0);
    expect(all.mock.calls).toHaveLength(0);
    expect(result?.result).toMatchObject({
      total: 1,
      sessionId: 's1',
      toolCalls: [{ toolCallId: 'a', hasError: false }],
    });
  });

  it('④ list_tool_calls：无 round 但有 session ⇒ 取会话全量', async () => {
    const bySession = stub(toolResultRegistry, 'listBySession', () => [
      stored('b', true),
    ]);

    const result = await tryHandleLocalQueryTool(
      {
        id: 'call-8',
        name: 'list_tool_calls',
        arguments: { sessionId: 's2' },
      },
      {}
    );

    expect(bySession.mock.calls).toHaveLength(1);
    expect(result?.result).toMatchObject({
      total: 1,
      toolCalls: [{ toolCallId: 'b', hasError: true }],
    });
  });

  it('④ list_tool_calls：无 session ⇒ 全量并截断为 50 条', async () => {
    const many = Array.from({ length: 60 }, (_, i) => stored(`t${i}`));
    stub(toolResultRegistry, 'listAll', () => many);

    const result = await tryHandleLocalQueryTool(
      { id: 'call-9', name: 'list_tool_calls', arguments: {} },
      {}
    );

    expect(result?.result).toMatchObject({ total: 50, sessionId: undefined });
  });
});
