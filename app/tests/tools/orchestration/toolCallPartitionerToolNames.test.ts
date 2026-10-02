/**
 * 工具名口径判据：分区器（Partitioner）必须按**本仓真实注册名**判定
 *
 * 背景（2026-09-26「第 5 处」取证）：`tools/orchestration/types.ts` 的三个清单
 * （`READ_ONLY_TOOLS` / `SERIALIZING_TOOLS` / `SEARCH_TOOLS`）沿用外部命名
 * （`Read`/`Write`/`Edit`/`Grep`/`Glob`…），而 `Partitioner` 收到的 `block.name`
 * 是**模型调用名**，本仓即**注册名**（`file_read`/`grep`/`glob`…）
 * ⇒ `isReadOnlyTool()` 对真实名**恒 false** ⇒ 只读工具永不被判为"可并发"。
 *
 * 本用例把"应当成立"的契约固定下来（不改任何实现即可判定真伪）：
 *  - 只读/搜索工具 ⇒ 应落 **`isConcurrencySafe: true`** 分区
 *  - 写入工具     ⇒ 应落 **`isConcurrencySafe: false`** 分区
 *
 * ⚠️ **修复前本用例为红（= 坐实缺陷）**；把三清单改为真实注册名后应转绿。
 * ⚠️ 未加"运行时来源断言"：`block.name` 的赋值链（provider 解析 → `tool_use.name`）
 * 本轮静态取证受上下文限制未取到，故此处只固定**契约面**，不断言来源。
 */
import { describe, test, expect } from 'bun:test';
import {
  partitionToolCalls,
  createToolCallPartitioner,
} from '../../../src/tools/orchestration/Partitioner';
import {
  READ_ONLY_TOOLS,
  SERIALIZING_TOOLS,
  SEARCH_TOOLS,
  isReadOnlyTool,
  needsSerialExecution,
  isSearchTool,
  isConcurrencySafe,
} from '../../../src/tools/orchestration/types';
import type { ToolUseBlock } from '@modules/session/types/ToolUseBlock';

/** 造一个工具使用块（`name` 为本仓真实注册名） */
function block(name: string): ToolUseBlock {
  return { type: 'tool_use', id: `id-${name}`, name, input: {} };
}

describe('Partitioner 工具名口径（本仓真实注册名）', () => {
  test('只读工具（file_read/glob/grep）⇒ 判为并发安全', () => {
    const names = ['file_read', 'glob', 'grep'];

    for (const name of names) {
      expect(isReadOnlyTool(name)).toBe(true);
      expect(isConcurrencySafe(name)).toBe(true);
    }

    const partitions = partitionToolCalls(names.map(block));
    expect(partitions).toHaveLength(1);
    expect(partitions[0].isConcurrencySafe).toBe(true);
    expect(partitions[0].blocks.map((b) => b.name)).toEqual(names);
  });

  test('写入工具（file_write/file_edit/bash）⇒ 判为串行（非并发安全）', () => {
    for (const name of ['file_write', 'file_edit', 'bash']) {
      expect(needsSerialExecution(name)).toBe(true);
      expect(isConcurrencySafe(name)).toBe(false);
    }
  });

  test('getConcurrentBlocks / getSerialBlocks 按真实名切分', () => {
    const partitioner = createToolCallPartitioner();
    const blocks = [block('file_read'), block('file_write'), block('grep')];

    expect(partitioner.getConcurrentBlocks(blocks).map((b) => b.name)).toEqual([
      'file_read',
      'grep',
    ]);
    expect(partitioner.getSerialBlocks(blocks).map((b) => b.name)).toEqual([
      'file_write',
    ]);
  });

  test('搜索工具集合按真实名成立（SEARCH_TOOLS/isSearchTool）', () => {
    expect(isSearchTool('grep')).toBe(true);
    expect(isSearchTool('glob')).toBe(true);
    // 2026-09-29（P2-3）：`file_search` **不是注册名**（仅存在于 `ToolFactory.getAllBaseTools()`
    // 死路径，台账 N-27）⇒ 已从 `SEARCH_TOOLS` 移除，此处**反向断言**防回退。
    expect(isSearchTool('file_search')).toBe(false);
    expect(SEARCH_TOOLS.has('file_search')).toBe(false);
  });

  test('防漂移守卫：三清单不得含外部（CC）命名', () => {
    const ccNames = [
      'Read',
      'Write',
      'Edit',
      'Bash',
      'Glob',
      'Grep',
      'WebSearch',
      'WebFetch',
      'ToolSearch',
      'TaskGet',
      'TaskList',
    ];

    for (const cc of ccNames) {
      expect(READ_ONLY_TOOLS.has(cc)).toBe(false);
      expect(SERIALIZING_TOOLS.has(cc)).toBe(false);
      expect(SEARCH_TOOLS.has(cc)).toBe(false);
    }
    // 且真实名必须在位
    expect(READ_ONLY_TOOLS.has('file_read')).toBe(true);
    expect(SERIALIZING_TOOLS.has('file_write')).toBe(true);
    expect(SEARCH_TOOLS.has('grep')).toBe(true);
  });
});
