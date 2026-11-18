/**
 * `buildCompletedToolCalls` 的特征化测试（2026-11-17，T3 复杂度清理）。
 *
 * 背景：该整形逻辑原内联在 `ReplApp.tsx` 的 `handleSubmit`（复杂度 66）里，
 * 负责把"模型侧 `finalMessage.tool_calls`"与"流内 `tool_end` 下发的执行结果"合并成
 * 可渲染的工具卡片。拆出为纯函数（`app/src/ink/repl/toolCallCards.ts`）后直接单测。
 *
 * 钉住的行为：
 *  ① 无 `tool_calls` ⇒ 空数组；
 *  ② 字符串形式参数（OpenAI 兼容载荷）⇒ 解析为对象；
 *  ③ 模型侧参数为空 ⇒ 回退流内已累积参数；
 *  ④ 流内结果按 id 合并 status / error / result（无则不带该字段）；
 *  ⑤ 缺失 name / id ⇒ 回退 `unknown` / 空串（与搬出前一致）。
 */
import { describe, expect, it } from 'bun:test';

import { buildCompletedToolCalls } from '../../src/ink/repl/toolCallCards';
import type { ToolCallSpec } from '@modules/runtime/api/CoreAPI';

function spec(partial: Record<string, unknown>): ToolCallSpec {
  return partial as unknown as ToolCallSpec;
}

describe('buildCompletedToolCalls：工具卡片整形（特征化）', () => {
  it('① 无 tool_calls ⇒ 空数组', () => {
    expect(buildCompletedToolCalls(undefined, new Map())).toEqual([]);
    expect(buildCompletedToolCalls([], new Map())).toEqual([]);
  });

  it('② 字符串参数 ⇒ 解析为对象；id / name 原样带上', () => {
    const result = buildCompletedToolCalls(
      [
        {
          id: 'call-1',
          function: { name: 'file_read', arguments: '{"path":"a.txt"}' },
        },
      ],
      new Map()
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'call-1',
      name: 'file_read',
      arguments: { path: 'a.txt' },
    });
  });

  it('③ 模型侧参数为空 ⇒ 回退流内累积参数', () => {
    const executed = new Map<string, ToolCallSpec>([
      ['call-2', spec({ id: 'call-2', name: 'grep', arguments: { q: 'x' } })],
    ]);

    const result = buildCompletedToolCalls(
      [{ id: 'call-2', function: { name: 'grep', arguments: '{}' } }],
      executed
    );

    expect(result[0]!.arguments).toEqual({ q: 'x' });
  });

  it('④ 流内执行结果按 id 合并 status / error / result', () => {
    const executed = new Map<string, ToolCallSpec>([
      [
        'call-3',
        spec({
          id: 'call-3',
          name: 'bash',
          arguments: { cmd: 'ls' },
          status: 'error',
          error: 'boom',
          result: 'partial',
        }),
      ],
    ]);

    const result = buildCompletedToolCalls(
      [{ id: 'call-3', function: { name: 'bash', arguments: '{"cmd":"ls"}' } }],
      executed
    );

    expect(result[0]).toMatchObject({
      status: 'error',
      error: 'boom',
      result: 'partial',
    });
  });

  it('④ 流内无记录 ⇒ 不携带 status / error / result 字段', () => {
    const result = buildCompletedToolCalls(
      [{ id: 'call-4', function: { name: 'glob', arguments: '{"p":"*"}' } }],
      new Map()
    );

    expect(Object.keys(result[0]!)).toEqual(['id', 'name', 'arguments']);
  });

  it('⑤ 缺失 name / id ⇒ 回退 unknown / 空串', () => {
    const result = buildCompletedToolCalls([{ arguments: {} }], new Map());

    expect(result[0]).toMatchObject({ id: '', name: 'unknown' });
  });
});
