/**
 * 会话级「tool_search 已发现工具」登记 + 补回（2026-11-07，方案 §6.4 续）
 *
 * 锁三件事：
 *  ① 登记去重 / 每会话上限 20 / 按会话隔离 / 可清空；
 *  ② `selectToolsForTurn` 会把已发现工具按名补回（未登记 ⇒ 与改动前完全一致）；
 *  ③ **重放路径**（`forcedVisibleTools`）不叠加已发现工具（工具面须恒等于落盘快照）。
 */
import { describe, expect, test, beforeEach } from 'bun:test';
import {
  clearDiscoveredTools,
  getDiscoveredTools,
  recordDiscoveredTools,
  resetDiscoveredToolsForTest,
} from '../../src/tools/discoveredTools';
import { selectToolsForTurn } from '../../src/chat/orchestrator/streamMessageToolSelection';
import type { ToolDefinition } from '@modules/ai';

function defs(names: string[]): ToolDefinition[] {
  return names.map((name) => ({
    type: 'function',
    function: { name },
  })) as unknown as ToolDefinition[];
}

const namesOf = (tools: ToolDefinition[]): string[] =>
  tools.map((t) => t.function?.name ?? '');

beforeEach(() => {
  resetDiscoveredToolsForTest();
});

describe('discoveredTools 登记', () => {
  test('去重 + 合并（重复搜索不会重复登记）', () => {
    recordDiscoveredTools('s1', ['powershell', 'code_run']);
    recordDiscoveredTools('s1', ['code_run', 'glob']);
    expect(getDiscoveredTools('s1')).toEqual([
      'powershell',
      'code_run',
      'glob',
    ]);
  });

  test('按会话隔离', () => {
    recordDiscoveredTools('s1', ['powershell']);
    expect(getDiscoveredTools('s2')).toEqual([]);
  });

  test('每会话上限 20：只保留最近的', () => {
    recordDiscoveredTools(
      's1',
      Array.from({ length: 25 }, (_, i) => `tool_${i}`)
    );
    const kept = getDiscoveredTools('s1');
    expect(kept).toHaveLength(20);
    expect(kept[0]).toBe('tool_5');
    expect(kept[19]).toBe('tool_24');
  });

  test('空会话 id / 空名单 ⇒ 不登记（不写共享桶）', () => {
    recordDiscoveredTools(undefined, ['powershell']);
    recordDiscoveredTools('s1', []);
    expect(getDiscoveredTools('')).toEqual([]);
    expect(getDiscoveredTools('s1')).toEqual([]);
  });

  test('clearDiscoveredTools 只清指定会话', () => {
    recordDiscoveredTools('s1', ['powershell']);
    recordDiscoveredTools('s2', ['glob']);
    clearDiscoveredTools('s1');
    expect(getDiscoveredTools('s1')).toEqual([]);
    expect(getDiscoveredTools('s2')).toEqual(['glob']);
  });
});

describe('selectToolsForTurn 补回已发现工具', () => {
  const tools = defs(['bash', 'code_run', 'powershell', 'web_fetch']);

  test('默认面（chat）不登记 ⇒ 披露面内的工具照旧，隐藏工具不出现', () => {
    const selection = selectToolsForTurn({
      tools,
      explicitTaskType: 'chat',
      lastUserText: 'hi',
      hasImages: false,
    });
    const kept = namesOf(selection.tools);
    expect(kept).toContain('bash');
    // `code_run` 不在披露面（且未登记）⇒ 不出现；不断言披露面完整成员（随平台/基线变化）
    expect(kept).not.toContain('code_run');
  });

  test('登记了 code_run ⇒ 补回（不受披露面 / 类别白名单限制）', () => {
    const selection = selectToolsForTurn({
      tools,
      explicitTaskType: 'chat',
      lastUserText: 'hi',
      hasImages: false,
      discoveredToolNames: ['code_run'],
    });
    expect(namesOf(selection.tools)).toContain('code_run');
  });

  test('已发现但仍不在全量定义里 ⇒ 不臆造（只有注册过的才补）', () => {
    const selection = selectToolsForTurn({
      tools,
      explicitTaskType: 'chat',
      lastUserText: 'hi',
      hasImages: false,
      discoveredToolNames: ['not_registered_tool'],
    });
    expect(namesOf(selection.tools)).not.toContain('not_registered_tool');
  });

  test('重放路径（forcedVisibleTools）不叠加已发现工具', () => {
    const selection = selectToolsForTurn({
      tools,
      explicitTaskType: 'chat',
      lastUserText: 'hi',
      hasImages: false,
      forcedVisibleTools: ['bash'],
      discoveredToolNames: ['code_run'],
    });
    expect(namesOf(selection.tools)).toEqual(['bash']);
  });
});
