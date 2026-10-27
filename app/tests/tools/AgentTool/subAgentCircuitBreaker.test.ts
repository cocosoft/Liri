/**
 * P2-1（2026-10-27）：子代理**轮级熔断**与主循环同阈值 + 分型（端到端）。
 *
 * 修复前：`SubAgentLoop` 构造时传 `maxConsecutiveInvalidTurns: 0`（= 关闭），且
 * `executeToolCall` 只要没抛异常就记 `ok:true` ⇒ ① 熔断器关着；② 即便打开也看不到
 * "全失败轮"。两条叠加 ⇒ 子代理跑飞时只能等 `maxTurns` 耗尽。
 *
 * 采集方式：复用 `SubAgentEngineConfig.llmClientOverride` 注入缝（同
 * `subAgentEngineRecovery.test.ts`），不触网、不读真实 DB。
 *
 * ⚠️ 每轮工具参数递增：避开 `maxRepeatedRounds`（签名级 no_progress）**先**触发，
 * 从而把被测对象隔离为"轮级熔断（circuit_breaker / environment_blocked）"。
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import type { AIProvider, ChatResponse } from '@modules/ai';
import { SubAgentEngine } from '../../../src/tools/AgentTool/SubAgentEngine';
import { resetAgentRunLedger } from '../../../src/tools/AgentTool/AgentRunLedger';
import type { Tool } from '../../../src/tools/types/Tool';

const SID = 'sess-p21';

let seq = 0;

/** 每轮返回一次工具调用；参数递增 ⇒ 轮签名不同（不触发签名级 no_progress） */
function makeLoopingProvider(toolName: string): AIProvider {
  return {
    id: 'fake-loop-provider',
    displayName: 'fake-loop',
    chat: async () =>
      ({
        content: '',
        tool_calls: [
          { id: `call-${++seq}`, name: toolName, arguments: { n: seq } },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }) as unknown as ChatResponse,
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

/** 结果固定的假工具（`success` / `failureKind` 由用例指定） */
function makeTool(result: Record<string, unknown>): Tool {
  return {
    name: 'failing_tool',
    execute: async () => ({ success: true, output: 'ok', ...result }),
  } as unknown as Tool;
}

function runEngine(
  toolName: string,
  tool: Tool,
  maxTurns = 10
): Promise<{
  completed: boolean;
  terminationReason?: string;
  turnsUsed: number;
  error?: string;
}> {
  const engine = new SubAgentEngine({
    llmClientOverride: makeLoopingProvider(toolName),
  });
  return engine.execute({
    agentId: `p21-${toolName}-${Math.random().toString(36).slice(2, 8)}`,
    systemPrompt: '你是测试 worker',
    messages: [{ role: 'user', content: 'go' }],
    tools: [],
    toolInstances: new Map([[toolName, tool]]),
    maxTurns,
    model: 'fake-model',
    toolContext: { sessionId: SID } as never,
  }) as never;
}

describe('P2-1 子代理轮级熔断', () => {
  beforeEach(() => {
    resetAgentRunLedger();
  });
  afterEach(() => {
    resetAgentRunLedger();
  });

  test('连续 3 轮全失败（工具自身失败）⇒ circuit_breaker，早于 maxTurns', async () => {
    const result = await runEngine(
      'failing_tool',
      makeTool({ success: false, output: 'boom' }),
      10
    );
    expect(result.terminationReason).toBe('circuit_breaker');
    expect(result.turnsUsed).toBe(3);
    expect(result.completed).toBe(false);
    // 归因可见：错误里带最近失败的工具名（修复前 error 为空）
    expect(result.error ?? '').toContain('failing_tool');
  });

  test('连续 2 轮环境阻塞（permission_denied）⇒ environment_blocked', async () => {
    const result = await runEngine(
      'failing_tool',
      makeTool({
        success: false,
        output: 'denied by rule',
        failureKind: 'permission_denied',
      }),
      10
    );
    expect(result.terminationReason).toBe('environment_blocked');
    expect(result.turnsUsed).toBe(2);
    expect(result.completed).toBe(false);
    expect(result.error ?? '').toContain('permission_denied');
  });

  test('负向对照：工具一直成功 ⇒ 不触发熔断（走到 maxTurns）', async () => {
    const result = await runEngine(
      'failing_tool',
      makeTool({ success: true, output: 'ok' }),
      4
    );
    expect(result.terminationReason).not.toBe('circuit_breaker');
    expect(result.terminationReason).not.toBe('environment_blocked');
    expect(result.turnsUsed).toBe(4);
  });
});
