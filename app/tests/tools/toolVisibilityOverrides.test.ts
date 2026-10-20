// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * P2「可控性」覆写层测试（2026-10-16，方案 `dev_docs/20261016/工具可见性治理方案-20261016.md` §4 P2）
 *
 * 四个目标：
 *   ① **零行为变更**（本期的第一硬约束）：空表 / 未配置 ⇒ **逐元素恒等**，且
 *      `selectToolsForTurn` 的输出与"不传 overrides"**深度相等**
 *   ② **加/减语义**：`off` 移除白名单内工具；`on` 从**裁剪前全量**补回（可放开类别白名单与归档）
 *   ③ **两条硬保护**：`MANDATORY_TOOLS` 不可 `off`（L1）；重放路径（`forcedVisibleTools`）**不叠覆写**（R6）
 *   ④ **报表同源**：`effective` 与 `reasons`（`user-off` / `user-on-bypass`）随同一份覆写变化；
 *      `on` 对"未进生成物"（`conditional`）**无效**（不凭空实例化 ⇒ 不给假承诺）
 *
 * ⚠️ 本测试**不手写**工具名单：一律取自 `TOOL_NAMES`（生成物）/ `MANDATORY_TOOLS` /
 * `ARCHIVED_MISC_TOOLS`（CS01）。
 */

import { describe, expect, it } from 'bun:test';
import {
  applyToolVisibilityOverrides,
  normalizeToolVisibilityOverrides,
} from '../../src/tools/toolVisibilityOverrides';
import {
  ARCHIVED_MISC_TOOLS,
  getMandatoryTools,
  filterToolsByTask,
} from '../../src/tools/toolCategories';
import { resolveToolVisibilityReport } from '../../src/tools/toolVisibilityReport';
import { TOOL_NAMES } from '../../src/constants/toolNames.generated';
import { selectToolsForTurn } from '../../src/chat/orchestrator/streamMessageToolSelection';

type ToolLike = { function?: { name?: string }; name?: string };

const ALL_TOOLS: ToolLike[] = TOOL_NAMES.map((n) => ({
  function: { name: n },
}));
const namesOf = (tools: readonly ToolLike[]): string[] =>
  tools.map((t) => t.function?.name ?? t.name ?? '');

function override(...entries: Array<[string, 'on' | 'off']>) {
  return normalizeToolVisibilityOverrides({
    overrides: Object.fromEntries(entries),
  });
}

describe('P2 覆写层：归一化（读取侧单一真源）', () => {
  it('非对象 / 缺 overrides / overrides 非对象 ⇒ 空表（视为未配置）', () => {
    expect(normalizeToolVisibilityOverrides(undefined)).toEqual({});
    expect(normalizeToolVisibilityOverrides(null)).toEqual({});
    expect(normalizeToolVisibilityOverrides('x')).toEqual({});
    expect(normalizeToolVisibilityOverrides({})).toEqual({});
    expect(normalizeToolVisibilityOverrides({ overrides: null })).toEqual({});
    expect(normalizeToolVisibilityOverrides({ overrides: [] })).toEqual({});
  });

  it('合法 on / off 保留；auto 不占键（等于"不登记"）', () => {
    const out = normalizeToolVisibilityOverrides({
      overrides: { bash: 'on', glob: 'off', grep: 'auto' },
    });
    expect(out).toEqual({ bash: 'on', glob: 'off' });
    expect(Object.keys(out)).not.toContain('grep');
  });

  it('非法取值 / 未知工具名 ⇒ 丢弃（不阻断、不臆造）', () => {
    const out = normalizeToolVisibilityOverrides({
      overrides: { bash: 'ON', glob: true, not_a_real_tool: 'on' },
    });
    expect(out).toEqual({});
  });

  it('生效恒集不可 off（L1 硬保护）；on 照常保留', () => {
    for (const name of getMandatoryTools()) {
      expect(override([name, 'off'])).toEqual({});
      expect(override([name, 'on'])).toEqual({ [name]: 'on' });
    }
  });
});

describe('P2 覆写层：加/减语义（切在 filterToolsByTask 之后）', () => {
  it('空表 ⇒ 逐元素恒等（对全部生效名做全量等价断言 —— 零行为变更的主闸）', () => {
    const kept = filterToolsByTask(ALL_TOOLS, 'default');
    const out = applyToolVisibilityOverrides(kept, ALL_TOOLS, {});
    expect(out).toEqual(kept);
    expect(namesOf(out)).toEqual(namesOf(kept));
  });

  it('空表 ⇒ 结果集合与 filterToolsByTask 逐字节一致（跨 taskType 全量交叉）', () => {
    for (const taskType of ['default', 'chat', 'coding', 'agent', 'local']) {
      const kept = filterToolsByTask(ALL_TOOLS, taskType);
      expect(
        namesOf(applyToolVisibilityOverrides(kept, ALL_TOOLS, {}))
      ).toEqual(namesOf(kept));
    }
  });

  it('off ⇒ 白名单内工具被移除（含恒保留之外的任意工具）', () => {
    const kept = filterToolsByTask(ALL_TOOLS, 'default');
    expect(namesOf(kept)).toContain('bash');
    const out = applyToolVisibilityOverrides(
      kept,
      ALL_TOOLS,
      override(['bash', 'off'])
    );
    expect(namesOf(out)).not.toContain('bash');
    // 其余工具不受影响（只减指定项）
    expect(namesOf(out)).toEqual(namesOf(kept).filter((n) => n !== 'bash'));
  });

  it('on ⇒ 从**裁剪前全量**补回（可放开类别白名单之外 / 有意归档的工具）', () => {
    const kept = filterToolsByTask(ALL_TOOLS, 'default');
    const archived = [...ARCHIVED_MISC_TOOLS];
    expect(archived.length).toBeGreaterThan(0);
    // 前提校验（防空转）：默认面确实不含归档工具
    for (const name of archived) expect(namesOf(kept)).not.toContain(name);

    const out = applyToolVisibilityOverrides(
      kept,
      ALL_TOOLS,
      override(...archived.map((n) => [n, 'on'] as [string, 'on']))
    );
    for (const name of archived) expect(namesOf(out)).toContain(name);
  });

  it('on 的补回位置取自全量顺序（结果稳定、可 diff）', () => {
    const kept = filterToolsByTask(ALL_TOOLS, 'default');
    const out = applyToolVisibilityOverrides(
      kept,
      ALL_TOOLS,
      override(['computer_use', 'on'])
    );
    const finalNames = namesOf(out);
    // 恒等式：最终顺序 == 全量顺序中"最终可见者"的相对顺序（与 `kept` 的原始顺序无关）
    expect(finalNames).toEqual(
      TOOL_NAMES.filter((n) => finalNames.includes(n))
    );
  });
});

describe('P2 接入点：selectToolsForTurn（单出口）', () => {
  const input = () => ({
    tools: ALL_TOOLS.map((t) => ({ ...t })) as never,
    explicitTaskType: undefined,
    lastUserText: '',
    hasImages: false,
  });

  it('不传 overrides 与传空表 ⇒ 输出深度相等（零行为变更）', () => {
    const base = selectToolsForTurn(input());
    const withEmpty = selectToolsForTurn({ ...input(), overrides: {} });
    expect(withEmpty).toEqual(base);
  });

  it('on ⇒ 归档工具进入最终工具集（可见性 ≠ 授权：仅放开可见）', () => {
    const before = selectToolsForTurn(input());
    expect(namesOf(before.tools as ToolLike[])).not.toContain('computer_use');
    const after = selectToolsForTurn({
      ...input(),
      overrides: override(['computer_use', 'on']),
    });
    expect(namesOf(after.tools as ToolLike[])).toContain('computer_use');
    // 差集留痕随之更新（供既有观测日志使用）
    expect(after.removedNames).not.toContain('computer_use');
  });

  it('off ⇒ 白名单内工具从最终工具集移除；恒保留工具不受 off 影响', () => {
    const mandatory = [...getMandatoryTools()][0]!;
    const after = selectToolsForTurn({
      ...input(),
      overrides: override(['bash', 'off'], [mandatory, 'off']),
    });
    const names = namesOf(after.tools as ToolLike[]);
    expect(names).not.toContain('bash');
    expect(names).toContain(mandatory);
  });

  it('重放路径（forcedVisibleTools）**不叠覆写** ⇒ 重放工具面恒等于落盘快照', () => {
    const snapshot = ['file_read'];
    const replayed = selectToolsForTurn({
      ...input(),
      forcedVisibleTools: snapshot,
      // 即使同时给了覆写，也必须被忽略（否则历史重放会随设置漂移）
      overrides: override(['computer_use', 'on'], ['file_read', 'off']),
    });
    expect(namesOf(replayed.tools as ToolLike[])).toEqual(snapshot);
  });
});

describe('P2 报表同源：effective 与 reasons 随同一份覆写变化', () => {
  const entryOf = (
    report: ReturnType<typeof resolveToolVisibilityReport>,
    name: string
  ) => report.find((r) => r.name === name)!;

  it('off ⇒ effective=hidden + user-off（visibleByDefault 保持不变）', () => {
    const entry = entryOf(
      resolveToolVisibilityReport({ overrides: override(['bash', 'off']) }),
      'bash'
    );
    expect(entry.visibleByDefault).toBe(true);
    expect(entry.effective).toBe('hidden');
    expect(entry.reasons).toContain('user-off');
  });

  it('on（归档）⇒ effective=visible + user-on-bypass', () => {
    const entry = entryOf(
      resolveToolVisibilityReport({
        overrides: override(['computer_use', 'on']),
      }),
      'computer_use'
    );
    expect(entry.visibleByDefault).toBe(false);
    expect(entry.effective).toBe('visible');
    expect(entry.reasons).toContain('user-on-bypass');
  });

  it('on 对「未进生成物」无效 ⇒ 仍 hidden（不凭空实例化，不给假承诺）', () => {
    const registered = new Set<string>(TOOL_NAMES);
    const conditional = resolveToolVisibilityReport().find(
      (r) => r.registration === 'conditional'
    )!;
    expect(registered.has(conditional.name)).toBe(false);
    const entry = entryOf(
      resolveToolVisibilityReport({
        overrides: override([conditional.name, 'on']),
      }),
      conditional.name
    );
    expect(entry.effective).toBe('hidden');
    expect(entry.reasons).toContain('conditional');
    expect(entry.reasons).not.toContain('user-on-bypass');
  });
});
