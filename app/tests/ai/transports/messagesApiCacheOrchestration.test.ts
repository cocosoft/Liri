/**
 * O2-3 接线（2026-09-24 晚，用户裁定"启用编排层"）：
 * `MessagesApiTransport` 的断点**位置与预算的唯一来源** = `PromptCacheConfig.calculateBreakpoints()`。
 *
 * 接线前是**两套并行实现**：transport 自行"只给最后一个 `tool_result` 打断点"，而编排层
 * 自 `i=0` 每 N 条放置 ⇒ 长会话**末尾无断点**（实测转换后 61 条消息时落在 `[2,5]`）
 * ⇒ 直接接线会比不接线更差。故先修语义（**末尾锚定**）再接线。
 *
 * 本文件锁定接线后的契约：
 *   1. **末尾恒有断点**（Anthropic 对多轮的推荐：断点覆盖缓存前缀的末尾）；
 *   2. 末尾之外按步长往前补，**至预算用尽**（默认 `system+tools+末尾+末尾-3` = 4 = 硬上限）；
 *   3. 策略经 `STRATEGY_SPEC` 真实生效（`system_only` 无 tools/message；`none` 全无）。
 */

import { describe, it, expect } from 'bun:test';
import { MessagesApiTransport } from '../../../src/ai/transports/AnthropicMessagesTransport.js';
import type { TransportRequestParams } from '../../../src/ai/transports/types.js';

const SYSTEM = { role: 'system', content: '你是助手。' };
const TOOLS = [
  {
    name: 'grep',
    description: 'd',
    parameters: { type: 'object', properties: {} },
  },
];

/** N 轮「assistant(tool_calls) + tool(result)」；转换后长度 = 1 + 2N */
function conversation(rounds: number): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [
    { role: 'user', content: '开始' },
  ];
  for (let i = 0; i < rounds; i++) {
    out.push({
      role: 'assistant',
      content: `step ${i}`,
      tool_calls: [
        { id: `tc_${i}`, function: { name: 'grep', arguments: '{}' } },
      ],
    });
    out.push({ role: 'tool', content: `result ${i}`, tool_call_id: `tc_${i}` });
  }
  return out;
}

function build(
  transport: MessagesApiTransport,
  rounds: number
): Record<string, unknown> {
  return transport.buildRequest({
    model: 'm',
    messages: [SYSTEM, ...conversation(rounds)],
    tools: TOOLS,
    maxTokens: 1024,
  } as unknown as TransportRequestParams);
}

/** 取请求体里各层带断点的位置（message 层给转换后的下标） */
function breakpointsOf(body: Record<string, unknown>): {
  system: number;
  tools: number;
  messages: number[];
} {
  const system = (body.system as Array<Record<string, unknown>>) ?? [];
  const tools = (body.tools as Array<Record<string, unknown>>) ?? [];
  const conv = body.messages as Array<{
    content: Array<Record<string, unknown>>;
  }>;
  const messages: number[] = [];
  conv.forEach((m, idx) => {
    if (m.content.some((b) => b.cache_control)) messages.push(idx);
  });
  return {
    system: system.filter((b) => b.cache_control).length,
    tools: tools.filter((t) => t.cache_control).length,
    messages,
  };
}

/** 转换后的消息条数（system 被跳过） */
function convertedLength(rounds: number): number {
  return 1 + rounds * 2;
}

describe('O2-3 接线：断点由编排层统一决定', () => {
  it('默认配置：**末尾恒有断点**，且总数 ≤ 4（含零工具轮）', () => {
    for (const rounds of [0, 1, 3, 10, 30]) {
      const bp = breakpointsOf(build(new MessagesApiTransport(), rounds));
      expect(bp.messages).toContain(convertedLength(rounds) - 1);
      expect(bp.system + bp.tools + bp.messages.length).toBeLessThanOrEqual(4);
    }
  });

  it('默认配置：末尾之外再有「末尾-3」阶梯（预算用尽为止）', () => {
    const bp = breakpointsOf(build(new MessagesApiTransport(), 10));
    expect(bp.messages).toEqual([17, 20]);
    expect(bp.system).toBe(1);
    expect(bp.tools).toBe(1);
  });

  it('零工具轮也有末尾断点（接线前的缺口：无 tool_result ⇒ message 层零断点）', () => {
    const bp = breakpointsOf(build(new MessagesApiTransport(), 0));
    expect(bp.messages).toEqual([0]);
  });

  it('策略 system_only ⇒ 只有 system 断点', () => {
    const t = new MessagesApiTransport();
    t.cacheConfig = {
      strategy: 'system_only',
      breakpointInterval: 3,
      maxBreakpoints: 4,
    };
    const bp = breakpointsOf(build(t, 10));
    expect(bp.system).toBe(1);
    expect(bp.tools).toBe(0);
    expect(bp.messages).toEqual([]);
  });

  it('策略 none ⇒ 零断点（即便 enableCaching=true）', () => {
    const t = new MessagesApiTransport();
    t.cacheConfig = {
      strategy: 'none',
      breakpointInterval: 3,
      maxBreakpoints: 4,
    };
    const bp = breakpointsOf(build(t, 10));
    expect(bp.system + bp.tools + bp.messages.length).toBe(0);
  });

  it('策略 system_and_6 ⇒ 阶梯步长为 6', () => {
    const t = new MessagesApiTransport();
    t.cacheConfig = {
      strategy: 'system_and_6',
      breakpointInterval: 3,
      maxBreakpoints: 4,
    };
    const bp = breakpointsOf(build(t, 10)); // 转换后 21 条 ⇒ 末尾 20、再往前 6 条 = 14
    expect(bp.messages).toEqual([14, 20]);
  });
});
