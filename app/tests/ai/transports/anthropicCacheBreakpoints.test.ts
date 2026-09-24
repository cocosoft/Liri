/**
 * N-1（2026-09-24 复查发现并修复）：`cache_control` 断点数**不得随会话历史线性增长**。
 *
 * 修复前 `convertMessages` 对**每一个** `tool_result` 块注入断点 ⇒ 断点数 ≈ `#tool_result + 2`
 * （另含 tools 末个与 system 稳定块），而本仓自述 Anthropic 硬上限为 **4**
 * （`ai/clients/PromptCacheConfig.ts:9`："超限请求会被拒绝"）。
 *
 * **O2-3 接线后的语义（2026-09-24 晚，用户裁定"启用编排层"）**：位置与预算统一由
 * `PromptCacheConfig.calculateBreakpoints()` 决定 —— **末尾锚定**（自最后一条消息往前每
 * `breakpointInterval` 一条，至预算用尽）⇒ 默认配置（`system_and_3` / 3 / 4）下为
 * `system + tools + 末尾 + 末尾-3` = **恒 ≤ 4**，且**短会话同样有末尾断点**（见用例 3）。
 *
 * 「修复前必失败」：20 条工具结果的历史 ⇒ 修复前断点数 = 22（> 4）；N-1 后恒 ≤ 3；
 * 接线后恒 ≤ 4（末尾锚定 + 阶梯）。
 */

import { describe, it, expect } from 'bun:test';
import { MessagesApiTransport } from '../../../src/ai/transports/AnthropicMessagesTransport.js';
import type { TransportRequestParams } from '../../../src/ai/transports/types.js';

const transport = new MessagesApiTransport();

/** 统计请求体里真实的 `cache_control` 断点数（`undefined` 键会被 JSON.stringify 丢弃） */
function countBreakpoints(body: Record<string, unknown>): number {
  return JSON.stringify(body).split('"cache_control"').length - 1;
}

function toolMessage(index: number): Record<string, unknown> {
  return {
    role: 'tool',
    content: `result-${index}`,
    tool_call_id: `tu_${index}`,
  };
}

function buildBody(
  messages: Array<Record<string, unknown>>,
  withTools = true
): Record<string, unknown> {
  const params = {
    model: 'test-model',
    maxTokens: 1024,
    messages,
    ...(withTools
      ? {
          tools: [
            {
              name: 'file_read',
              description: 'read',
              parameters: { type: 'object', properties: {} },
            },
          ],
        }
      : {}),
  } as unknown as TransportRequestParams;
  return transport.buildRequest(params);
}

const SYSTEM = { role: 'system', content: '你是助手。' };

describe('N-1：cache_control 断点数恒 ≤ 4（不随历史增长）', () => {
  it('长历史（20 条工具结果）⇒ 断点数 ≤ 4（修复前为 22）', () => {
    const messages = [
      SYSTEM,
      { role: 'user', content: '开始' },
      ...Array.from({ length: 20 }, (_, i) => toolMessage(i)),
    ];

    const body = buildBody(messages);
    const count = countBreakpoints(body);

    expect(count).toBeLessThanOrEqual(4);
    // O2-3 接线后：system 稳定块 + tools 末个 + 末尾锚定的两个 message 断点（@末 与 @末-3）
    expect(count).toBe(4);
  });

  it('只有最后一个 tool_result 带断点（前序工具结果不带）', () => {
    const body = buildBody([
      SYSTEM,
      toolMessage(1),
      toolMessage(2),
      toolMessage(3),
    ]);
    const messages = body.messages as Array<{
      role: string;
      content: Array<{
        type: string;
        tool_use_id?: string;
        cache_control?: unknown;
      }>;
    }>;

    const toolBlocks = messages
      .flatMap((m) => m.content)
      .filter((b) => b.type === 'tool_result');

    expect(toolBlocks.map((b) => b.tool_use_id)).toEqual([
      'tu_1',
      'tu_2',
      'tu_3',
    ]);
    expect(toolBlocks.map((b) => b.cache_control !== undefined)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it('无工具结果 ⇒ system + tools + **末尾 message** 三个断点', () => {
    const body = buildBody([SYSTEM, { role: 'user', content: '你好' }]);
    // O2-3 接线后：末尾锚定 ⇒ 即使没有任何 tool_result，末尾也必须有断点
    // （原实现只看 `lastToolMessageIndex` ⇒ 此种请求 message 层零断点、末尾永不进缓存）
    expect(countBreakpoints(body)).toBe(3);
  });

  it('关闭缓存（enableCaching=false）⇒ 零断点', () => {
    const t = new MessagesApiTransport();
    t.enableCaching = false;
    const params = {
      model: 'test-model',
      maxTokens: 1024,
      messages: [SYSTEM, toolMessage(1), toolMessage(2)],
      tools: [
        {
          name: 'file_read',
          description: 'read',
          parameters: { type: 'object', properties: {} },
        },
      ],
    } as unknown as TransportRequestParams;

    expect(countBreakpoints(t.buildRequest(params))).toBe(0);
  });
});
