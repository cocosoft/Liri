import { describe, expect, it } from 'bun:test';
import { ToolFactory } from '../../src/tools/ToolFactory';
import {
  getAllBuiltinToolLoaders,
  loadTools,
} from '../../src/tools/utils/ToolManagerUtils';
import {
  TOOL_NAMES,
  TOOL_NAMES_COUNT,
} from '../../src/constants/toolNames.generated';

/**
 * P2-3 门禁②：**新注册的工具必须进入生成物**（`src/constants/toolNames.generated.ts`）
 *
 * 失败时的处置：执行 `bun run gen:toolnames` 重新生成并提交产物。
 * 依据：`.trae/specs/tool-name-compile-time-enum.md`（T3）
 */
describe('P2-3 工具名生成物（编译期枚举）', () => {
  const tools = loadTools(new ToolFactory(), getAllBuiltinToolLoaders());
  const currentNames = [...new Set(tools.map((t) => t.name))].sort();

  it('生成物与当前内建清单一致（新增/改名工具未重新生成 ⇒ 失败）', () => {
    expect([...TOOL_NAMES]).toEqual(currentNames);
  });

  it('TOOL_NAMES_COUNT 与生成物一致', () => {
    expect(TOOL_NAMES_COUNT).toBe(TOOL_NAMES.length);
  });

  it('内建清单内无重复工具名（锁定 D-29 的去重结果）', () => {
    const names = tools.map((t) => t.name);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });

  it('生成物已排序去重（保证生成确定性）', () => {
    expect([...TOOL_NAMES].sort()).toEqual([...TOOL_NAMES]);
    expect(new Set(TOOL_NAMES).size).toBe(TOOL_NAMES.length);
  });
});
