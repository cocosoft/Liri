// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `metadata.tool_calls` 声明合并（2026-11-20 根因修复的回归）
 *
 * 真机：`msg-turn-mwmumwam-39d44c` 事件侧有 2 个 `assistant/tool_call`（bash / file_write），
 * 落盘只声明后一个 ⇒ 另一个 tool 结果成孤儿 ⇒ transport 剥离（43/53）⇒ 模型看不到工具输出。
 */

import { describe, expect, it } from 'bun:test';
import {
  mergeResponseToolCalls,
  mergeToolCallDeclarations,
  toToolCallDeclarations,
  type ToolCallDeclaration,
} from '../../src/chat/utils/toolCallDeclarations.js';

const call = (id: string, name = 'bash'): ToolCallDeclaration => ({
  id,
  type: 'function',
  function: { name, arguments: '{}' },
});

describe('mergeToolCallDeclarations', () => {
  it('无既有声明 ⇒ 原样返回本步声明（顺序不变）', () => {
    const incoming = [call('a'), call('b')];
    expect(mergeToolCallDeclarations(undefined, incoming)).toEqual(incoming);
  });

  it('跨步合并：前一步声明不被覆盖（真机形态）', () => {
    const merged = mergeToolCallDeclarations([call('step1')], [call('step2')]);
    expect(merged.map((c) => c.id)).toEqual(['step1', 'step2']);
  });

  it('同 id 重放 ⇒ 不产生重复声明', () => {
    const merged = mergeToolCallDeclarations(
      [call('a')],
      [call('a'), call('b')]
    );
    expect(merged.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('同 id 内容更新 ⇒ 以后到者为准', () => {
    const merged = mergeToolCallDeclarations(
      [call('a', 'old')],
      [call('a', 'new')]
    );
    expect(merged).toHaveLength(1);
    expect((merged[0]?.function as { name: string }).name).toBe('new');
  });

  it('缺 id 的项保留且不参与去重（不丢声明）', () => {
    const merged = mergeToolCallDeclarations(
      [{ type: 'function' }],
      [{ type: 'function' }, call('x')]
    );
    expect(merged).toHaveLength(3);
    expect(merged[2]?.id).toBe('x');
  });

  it('不修改入参（纯度）', () => {
    const existing = [call('a')];
    const incoming = [call('b')];
    const snapshot = JSON.stringify([existing, incoming]);
    mergeToolCallDeclarations(existing, incoming);
    expect(JSON.stringify([existing, incoming])).toBe(snapshot);
  });
});

describe('toToolCallDeclarations / mergeResponseToolCalls', () => {
  it('响应 → 声明：arguments 对象字符串化，名称/ id 保留', () => {
    const out = toToolCallDeclarations([
      { id: 'c1', name: 'file_write', arguments: { a: 1 } },
      { id: 'c2', name: 'bash', arguments: '{"x":2}' },
    ]);
    expect(out[0]).toEqual({
      id: 'c1',
      type: 'function',
      function: { name: 'file_write', arguments: '{"a":1}' },
    });
    expect((out[1]?.function as { arguments: string }).arguments).toBe(
      '{"x":2}'
    );
  });

  it('metadata 为空/异形 ⇒ 视为无既有声明', () => {
    for (const meta of [undefined, null, {}, { other: 1 }]) {
      const merged = mergeResponseToolCalls(meta, [
        { id: 'c1', name: 'bash', arguments: {} },
      ]);
      expect(merged.map((c) => c.id)).toEqual(['c1']);
    }
  });

  it('跨步合并真机形态：上一步的声明必须保留', () => {
    const step1 = { tool_calls: [call('call_seq14')] };
    const merged = mergeResponseToolCalls(step1, [
      { id: 'call_seq21', name: 'file_write', arguments: {} },
    ]);
    expect(merged.map((c) => c.id)).toEqual(['call_seq14', 'call_seq21']);
  });
});
