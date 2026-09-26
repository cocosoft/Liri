/**
 * `TOOL_CALL_END.status` 必须反映**真实执行结果**（2026-09-25 修复）。
 *
 * **缺陷**：`SubAgentEngine` 发布 `TOOL_CALL_END` 时 `status` **硬编码 `'completed'`**，
 * 而同一次回调里已握有真实结果 `ok`（`executeToolCall` 的结构化返回）—— 工具**缺失 /
 * 执行抛错**（`ok=false`）的事件因此被记成"已完成"，编排事件流与历史 JSONL 双双失真。
 * 同一回调内另有两次按真实结果取值（`stepFacts:{ok}`、`results.status`）⇒ 属口径不一致的疏漏。
 *
 * **为什么必须用真引擎**：`parallelTasks.test.ts` 的 `installEngine()` 会把引擎整个替换掉
 * ⇒ 本条事件根本不经过被测代码。这里用 `SubAgentEngineConfig.llmClientOverride`（测试缝）
 * 注入假供应商，驱动真实 `reason → act → onToolResult` 链路（与 `subAgentEngineRecovery.test.ts` 同法）。
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import type { AIProvider, ChatResponse } from '@modules/ai';
import { AgentEventType } from '../../../src/agent/events/types';
import { globalEventBus } from '../../../src/core/events/EventBus.js';
import { resetAgentRunLedger } from '../../../src/tools/AgentTool/AgentRunLedger';
import { SubAgentEngine } from '../../../src/tools/AgentTool/SubAgentEngine';

/**
 * 假供应商：**首轮**请求一个**不存在的**工具（`executeToolCall` 对缺失工具返回
 * `ok=false` 且不抛错，见 `SubAgentEngine.executeToolCall`），**次轮**给无工具调用的
 * 收尾响应（`finishReason: 'stop'`）⇒ 循环恰好执行 1 次工具调用后结束。
 */
function makeFakeProvider(): AIProvider {
  let call = 0;
  return {
    id: 'fake-provider',
    displayName: 'fake',
    chat: async () => {
      call += 1;
      if (call === 1) {
        return {
          content: '',
          tool_calls: [
            { id: 'tc-missing', name: 'nonexistent_tool_xyz', arguments: {} },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        } as unknown as ChatResponse;
      }
      return {
        content: 'done',
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      } as unknown as ChatResponse;
    },
    chatStream: async function* (): AsyncGenerator<
      string,
      ChatResponse,
      unknown
    > {
      return { content: '' } as ChatResponse;
    },
    listModels: async () => ['fake-model'],
    validateConfig: () => ({ valid: true, errors: [], warnings: [] }),
  };
}

describe('TOOL_CALL_END.status 反映真实结果', () => {
  beforeEach(() => {
    resetAgentRunLedger();
  });

  afterEach(() => {
    resetAgentRunLedger();
  });

  test('工具缺失（ok=false）⇒ status 必须是 failed（修复前恒为 completed）', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const sub = globalEventBus.subscribe(
      AgentEventType.TOOL_CALL_END,
      (data: unknown) => {
        seen.push(data as Record<string, unknown>);
      }
    );

    try {
      const engine = new SubAgentEngine({
        llmClientOverride: makeFakeProvider(),
      });
      await engine.execute({
        agentId: 'tool-call-end-status::t1',
        systemPrompt: '测试',
        messages: [{ role: 'user', content: 'hi' }],
        tools: [],
        // 空 Map ⇒ `nonexistent_tool_xyz` 必然缺失 ⇒ executeToolCall 返回 ok=false
        toolInstances: new Map(),
        maxTurns: 3,
        model: 'fake-model',
        toolContext: { sessionId: 'sess-status' } as never,
      });
    } finally {
      sub.unsubscribe();
    }

    // 前提校验（防假绿）：该工具调用的 END 事件确实发生过 —— 否则下面的断言可能因"没事件"而空过
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ toolName: 'nonexistent_tool_xyz' });
    // 核心断言：失败不得被报成完成
    expect(seen[0].status).toBe('failed');
  });
});
