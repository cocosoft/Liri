/**
 * U-03（2026-10-19）：工具 UI 注册表**真实可用**且键必须是**真实工具名**。
 *
 * 背景：原实现用 46 段 `require('./toolUIs/…')`，而 UI 模块是 async 模块
 * —— Bun 明确报 `require() async module is unsupported` ⇒ 全部落入 catch、
 * 注册表永远为空（专用 UI 从未生效）。现改为 `await import()` 台账，本用例
 * 通过**实际初始化**锁住两件事：
 * ① 真实工具名能拿到渲染器（`mcp_resource` 不再因键错配而落空）；
 * ② 注册表里不出现非工具名（`mcp` / `think` / `time` / `*_plan_mode`）。
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import {
  getRegisteredToolNames,
  hasToolUI,
  initDefaultToolUIRegistry,
  resetDefaultToolUIRegistryForTests,
} from '../../src/components/ui/ToolUIRegistry';
import { TOOL_NAME_CONSTANTS } from '../../src/tools/toolNameConstants';

const DECLARED_NAMES = new Set<string>(Object.values(TOOL_NAME_CONSTANTS));

describe('ToolUIRegistry 可用性与键名（U-03）', () => {
  beforeEach(() => {
    resetDefaultToolUIRegistryForTests();
  });

  it('初始化后真实工具名可命中专用 UI', async () => {
    await initDefaultToolUIRegistry();

    expect(hasToolUI('mcp_resource')).toBe(true);
    expect(hasToolUI('file_read')).toBe(true);
    expect(hasToolUI('bash')).toBe(true);
    // P1（2026-10-30）：cron 四件合并为 `cron`（专用 UI 改挂合并名）
    expect(hasToolUI('cron')).toBe(true);
    expect(hasToolUI('worktree')).toBe(true);
  });

  it('非工具名不再注册（错配回流即红）', async () => {
    await initDefaultToolUIRegistry();

    for (const deadName of [
      'mcp',
      'think',
      'time',
      'agenttool',
      'enter_plan_mode',
      'exit_plan_mode',
      // 2026-10-23（Q-18 尾项）：`voice_output` 判定为 `tts` 的子集死代码 ⇒ 已摘登记
      'voice_output',
    ]) {
      expect(hasToolUI(deadName)).toBe(false);
    }
  });

  /**
   * **U-03 台账缺口白名单**（`TOOL_NAME_CONSTANTS` 之外的**真实实现**工具名）：
   * 这些工具在源码里有工具类/工厂与专用 UI，但**尚未登记进名称常量表**
   * （台账 §U-03「模块工具不入名称/效果/报表台账」与「非常量实现」两条）。
   * 此处**显式列出**而非放宽断言：新增任何未登记名字仍会失败，必须显式登记或补表。
   */
  const UNDECLARED_BUT_REAL_NAMES = [
    'code_analysis',
    'knowledge_delete',
    'knowledge_export',
    'knowledge_import',
    'knowledge_restore',
    'knowledge_snapshots',
    'knowledge_search',
    'knowledge_write',
    'push_notification',
    'subscribe_pr',
    'voice_input',
  ];

  it('注册表键 = 工具名声明面 + 已知未登记实现（新增未登记名字即红）', async () => {
    await initDefaultToolUIRegistry();

    const unknown = getRegisteredToolNames()
      .filter(
        (n) => !DECLARED_NAMES.has(n) && !UNDECLARED_BUT_REAL_NAMES.includes(n)
      )
      .sort();
    expect(unknown).toEqual([]);
  });

  it('初始化幂等：重复调用不重复注册、结果一致', async () => {
    await initDefaultToolUIRegistry();
    const first = getRegisteredToolNames().sort();
    await initDefaultToolUIRegistry();
    expect(getRegisteredToolNames().sort()).toEqual(first);
    expect(first.length).toBeGreaterThan(40);
  });
});
