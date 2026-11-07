/**
 * TAOR 适配器：`tool_search` 命中后**同轮**补回工具定义（2026-11-07，方案 §13.3）
 *
 * 取证：TAOR 每轮 `sendModelRequest` 都现读 `ctx.toolDefinitions`（`ChatManagerTAORAdapter` 内
 * `tools: ctx.toolDefinitions.length > 0 ? … : undefined`）⇒ 工具结果之后补进同一数组，
 * 同轮下一次请求即携带 schema。
 *
 * 本用例锁「接线」而非算法（算法在 `discoveredTools.test.ts` 已覆盖）：
 * 走真实的 `createChatManagerTAORDeps` + 全局注册表，断言执行一次工具后 `ctx.toolDefinitions` 增长。
 */
import { describe, expect, it, afterAll } from 'bun:test';

import {
  createChatManagerTAORDeps,
  type ChatManagerTAORContext,
} from '../../src/query/ChatManagerTAORAdapter.js';
import {
  getToolRegistry,
  recordDiscoveredTools,
  resetDiscoveredToolsForTest,
} from '../../src/tools';
import type { Tool } from '../../src/tools/types/Tool';

const SID = 'sess-discovered-tools';
const TOOL_NAME = 'disc_probe_tool';

/** 最小工具（只为能进 `getToolSchemas()`；不执行任何逻辑） */
const probeTool = {
  name: TOOL_NAME,
  description: '请勿注册到生产：测试探针',
  params: [],
  execute: async () => ({ success: true }),
  getInfo: () => ({
    name: TOOL_NAME,
    description: '请勿注册到生产：测试探针',
    params: [],
  }),
} as unknown as Tool;

function makeCtx(): ChatManagerTAORContext {
  return {
    sessionId: SID,
    sendModelRequest: async () => ({ content: '' }),
    executeTool: async (toolCall: {
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    }) => ({
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      result: 'ok',
    }),
    persistMessage: () => {},
    toolDefinitions: [],
    toolRegistry: { getTool: () => undefined },
    pendingInteractions: new Map(),
  } as unknown as ChatManagerTAORContext;
}

afterAll(() => {
  // 全局注册表是单例：用完立刻摘掉，避免影响其它用例的工具总数断言
  getToolRegistry().unregisterTool(TOOL_NAME);
  resetDiscoveredToolsForTest();
});

describe('TAOR 适配器：tool_search 命中后补回工具定义', () => {
  it('执行一次工具后，已发现工具出现在 ctx.toolDefinitions（同轮生效）', async () => {
    getToolRegistry().registerTool(probeTool);
    recordDiscoveredTools(SID, [TOOL_NAME]);

    const ctx = makeCtx();
    const deps = createChatManagerTAORDeps(ctx);
    const controller = new AbortController();
    await deps.executeTools(
      [{ id: 'tc-1', name: 'bash', arguments: {} }],
      controller.signal
    );

    const names = ctx.toolDefinitions.map((t) => t.function?.name ?? '');
    expect(names).toContain(TOOL_NAME);
  });

  it('未登记 ⇒ 不补（零行为变更）', async () => {
    resetDiscoveredToolsForTest();
    const ctx = makeCtx();
    const deps = createChatManagerTAORDeps(ctx);
    await deps.executeTools(
      [{ id: 'tc-2', name: 'bash', arguments: {} }],
      new AbortController().signal
    );
    expect(ctx.toolDefinitions).toHaveLength(0);
  });
});
