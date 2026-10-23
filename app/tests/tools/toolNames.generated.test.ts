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
import { BUILD_VARIANT_FLAGS } from '../../src/bootstrap/generatedVariantFlags';
import { setBuildVariantFlags } from '@openliri/kernel';
import { resetToolFlags } from '../../src/tools/utils/ToolFeatureFlags';

/**
 * 与生成器（`scripts/gen-tool-names.ts`）**同口径**：先注入变体层再装配工具。
 *
 * 为什么必须显式注入（P6 实测）：守卫上线后，未注入时 `feature()` 回落**静态默认**，
 * 而生成物是按**变体矩阵**产出的 —— 两者工具集会差出变体专属项（实证：`team_create`
 * / `team_delete`，其静态默认是 `false`、coding 矩阵是 `true`）。
 *
 * 为什么要紧接着 `resetToolFlags()`：`ToolFeatureFlags` 的开关表是**一次性惰性缓存**
 * （TR-18），若在本文件注入之前已被别的模块首读，缓存里就是静态默认值 ⇒ 顺序依赖。
 * 这里显式重置，使断言与「谁先读了缓存」无关。
 */
setBuildVariantFlags(BUILD_VARIANT_FLAGS);
resetToolFlags();

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
