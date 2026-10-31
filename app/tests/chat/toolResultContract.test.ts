/**
 * 工具结果三态契约（2026-11-01）。
 *
 * 钉住 `createToolResultMessage` 这个**唯一收口**的语义：
 *   · 成功有输出 ⇒ 原样透传；
 *   · 成功无输出（`undefined` / `null` / 空白串）⇒ 显式标记，**不再**是 `""` 或 `undefined`
 *     （此前模型无法区分"成功但没内容"与"调用没生效"，会换措辞重做同一动作）；
 *   · 失败 ⇒ 保留既有失败前缀与 `status=FAILED`；
 *   · `[]` / `{}` 等**有语义的空容器原样透传** —— grep 的"零命中"是结论，不是"没输出"。
 */
import { describe, expect, it } from 'bun:test';
import { createMessageService } from '../../src/chat/services/MessageService';
import {
  EMPTY_SUCCESS_TOOL_RESULT_TEXT,
  classifyToolResult,
} from '../../src/chat/services/toolResultContract';
import type { ToolResult } from '../../src/session/types/tool';

function toolResult(partial: Partial<ToolResult>): ToolResult {
  return {
    toolCallId: 'call_1',
    toolName: 'demo_tool',
    ...partial,
  };
}

function valueOf(tr: ToolResult): unknown {
  const msg = createMessageService().createToolResultMessage(tr, {
    sessionId: 's1',
  });
  const first = (msg.content as Array<{ value?: unknown }>)[0];
  return first?.value;
}

describe('工具结果三态契约', () => {
  it('classifyToolResult：失败 / 成功无输出 / 成功有输出', () => {
    expect(classifyToolResult({ error: 'boom' })).toBe('error');
    expect(classifyToolResult({ result: undefined })).toBe('empty-success');
    expect(classifyToolResult({ result: null })).toBe('empty-success');
    expect(classifyToolResult({ result: '' })).toBe('empty-success');
    expect(classifyToolResult({ result: '   \n ' })).toBe('empty-success');
    expect(classifyToolResult({ result: 'ok' })).toBe('success');
    expect(classifyToolResult({ result: 0 })).toBe('success');
    expect(classifyToolResult({ result: false })).toBe('success');
  });

  it('成功有输出 ⇒ 原样透传（不套标记）', () => {
    expect(valueOf(toolResult({ result: 'hello' }))).toBe('"hello"');
    expect(valueOf(toolResult({ result: { a: 1 } }))).toBe('{"a":1}');
  });

  it('空容器不套标记（grep 零命中 / 空对象是结论）', () => {
    expect(valueOf(toolResult({ result: [] }))).toBe('[]');
    expect(valueOf(toolResult({ result: {} }))).toBe('{}');
    expect(valueOf(toolResult({ result: 0 }))).toBe('0');
    expect(valueOf(toolResult({ result: false }))).toBe('false');
  });

  it.each([
    ['空字符串', ''],
    ['空白字符串', '   '],
    ['undefined', undefined],
    ['null', null],
  ])('成功但无输出（%s）⇒ 显式标记', (_label, result) => {
    const value = valueOf(toolResult({ result }));
    expect(value).toBe(EMPTY_SUCCESS_TOOL_RESULT_TEXT);
    expect(String(value)).not.toBe('""');
    // 必须同时说明"不是失败"与"不要原样重调"
    expect(String(value)).toContain('不代表失败');
    expect(String(value)).toContain('请勿使用相同参数重复调用');
  });

  it('失败 ⇒ 保留失败前缀，不出现"工具执行成功"', () => {
    const value = String(valueOf(toolResult({ result: '', error: 'boom' })));
    expect(value).toContain('⚠️ 工具执行失败: boom');
    expect(value).not.toContain('工具执行成功');

    const msg = createMessageService().createToolResultMessage(
      toolResult({ result: 'detail', error: 'boom' })
    );
    expect(msg.status).toBe('failed');
    expect(
      (msg.metadata as Record<string, unknown> | undefined)?.['isError']
    ).toBe(true);
  });

  it('三态落盘为可审计标记（便于度量空转占比）', () => {
    const svc = createMessageService();
    const stateOf = (tr: ToolResult): unknown =>
      (svc.createToolResultMessage(tr).metadata as Record<string, unknown>)[
        'toolResultState'
      ];

    expect(stateOf(toolResult({ result: '' }))).toBe('empty-success');
    expect(stateOf(toolResult({ result: 'ok' }))).toBe('success');
    expect(stateOf(toolResult({ result: '', error: 'boom' }))).toBe('error');
    // 调用方自带的 metadata 不被覆盖
    const withMeta = svc.createToolResultMessage(toolResult({ result: 'ok' }), {
      metadata: { callSeq: 7 },
    });
    expect(withMeta.metadata).toMatchObject({
      callSeq: 7,
      toolResultState: 'success',
    });
  });
});
