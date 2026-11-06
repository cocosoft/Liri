// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 2026-11-06（审批根因簇 P0-2，非流式路径回归锁）。
//
// 背景：`TAORLoop` 是 `sendMessage`（非流式）/ PDCA / LRO 的批处理执行路径。
// 修复前工具返回 `awaiting_approval` 被当作普通成功结果 ⇒ 循环继续跑下一轮，
// 审批卡在回合内过期；且 `getTerminationReason()` 由 `stopReason` 映射，
// 骨架置的 `awaiting_approval` 相位会被折叠成 `completed`（"任务完成"假象）。
//
// 本文件锁定三件事：
//   ① `act()` 从批处理结果派生 `awaitingApproval`（不解析文案，认结构化字段）；
//   ② 无审批时该字段为 false（零行为变更）；
//   ③ `getTerminationReason()` 优先读骨架相位，不被 stopReason 映射遮蔽。

import { describe, expect, it } from 'bun:test';
import { TAORLoop } from '../../src/query/TAORLoop';
import type { QueryEngine } from '../../src/query/QueryEngine';
import { isAwaitingApprovalPayload } from '@openliri/infra/utils/toolContract';

interface ActResult {
  results: Array<{ toolCallId: string; name: string; status: string }>;
  allSucceeded: boolean;
  anyAborted: boolean;
  awaitingApproval?: boolean;
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
    checkToolCall(name: string, input: unknown): { allowed: boolean };
  };
  state: { phase: string };
  messages: Array<{ role: string }>;
  act(
    calls: Array<{ id: string; name: string; input: unknown }>
  ): AsyncGenerator<unknown, ActResult>;
}

function makeLoop(): TestableLoop {
  const loop = new TAORLoop(
    {} as unknown as QueryEngine
  ) as unknown as TestableLoop;
  loop.pathGuard = { checkToolCall: () => ({ allowed: true }) };
  return loop;
}

async function drain(
  gen: AsyncGenerator<unknown, ActResult>
): Promise<ActResult> {
  for (;;) {
    const r = await gen.next();
    if (r.done) return r.value;
  }
}

const AWAITING_RESULT = {
  status: 'awaiting_approval',
  message: "工具 'bash' 需要审批，已提交审批卡片等待用户批准",
  pendingApproval: true,
  inboxId: 'inbox-1',
};

describe('非流式 TAOR：工具提交审批 ⇒ 本轮标记 awaitingApproval', () => {
  it('批处理结果含 pendingApproval ⇒ actResult.awaitingApproval = true', async () => {
    const loop = makeLoop();
    loop.deps = {
      executeTools: async (calls) =>
        calls.map((c) => ({
          toolCallId: c.id,
          toolName: c.name,
          result: AWAITING_RESULT,
        })),
    };

    const actResult = await drain(
      loop.act([{ id: 'c1', name: 'bash', input: { command: 'bun test' } }])
    );

    expect(actResult.awaitingApproval).toBe(true);
    // 审批等待不是失败（工具调用本身没报错），保持既有 allSucceeded 语义
    expect(actResult.allSucceeded).toBe(true);
  });

  it('负向：普通结果 ⇒ awaitingApproval 为 false（零行为变更）', async () => {
    const loop = makeLoop();
    loop.deps = {
      executeTools: async (calls) =>
        calls.map((c) => ({
          toolCallId: c.id,
          toolName: c.name,
          result: { ok: true },
        })),
    };

    const actResult = await drain(
      loop.act([{ id: 'c1', name: 'file_list', input: {} }])
    );

    expect(actResult.awaitingApproval).toBe(false);
  });

  it('终止原因优先读骨架相位：phase=awaiting_approval ⇒ 不被 stopReason 折叠成 completed', () => {
    const loop = makeLoop() as unknown as TestableLoop & {
      getTerminationReason(): string;
    };
    // stopReason 默认 'completed'（_initRunState 写入）⇒ 修复前这里返回 'completed'
    loop.state.phase = 'awaiting_approval';
    expect(loop.getTerminationReason()).toBe('awaiting_approval');
  });
});

describe('isAwaitingApprovalPayload（infra 契约层单一判据）', () => {
  it('对象 / JSON 字符串两种载荷都识别', () => {
    expect(isAwaitingApprovalPayload(AWAITING_RESULT)).toBe(true);
    expect(isAwaitingApprovalPayload(JSON.stringify(AWAITING_RESULT))).toBe(
      true
    );
  });

  it('负向：普通结果 / 非法 JSON / 空值不得误判', () => {
    expect(isAwaitingApprovalPayload({ ok: true })).toBe(false);
    expect(isAwaitingApprovalPayload('{"ok":true}')).toBe(false);
    expect(isAwaitingApprovalPayload('not-json')).toBe(false);
    expect(isAwaitingApprovalPayload(null)).toBe(false);
    expect(isAwaitingApprovalPayload(undefined)).toBe(false);
    // 只认 true（字符串 "true" 不算）
    expect(isAwaitingApprovalPayload({ pendingApproval: 'true' })).toBe(false);
  });
});
