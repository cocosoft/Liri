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
 * P1「可解释性」报表测试（2026-10-16，方案 `dev_docs/20261016/工具可见性治理方案-20261016.md`）
 *
 * 四个目标：
 *   ① **覆盖面**：90 个常量名全覆盖、无重复、稳定排序（可 diff）
 *   ② **自洽**：`hidden` 必带原因；`visible` 的原因或为空、或仅 `mandatory`
 *   ③ **与真实裁剪同口径**：对**全部生效工具名**逐一交叉断言
 *      `report.visibleByDefault === (filterToolsByTask([{name}], taskType).length === 1)`
 *      —— 这条是本模块的**防漂移主闸**：报表一旦与 `filterToolsByTask` 分家即红
 *   ④ **判词可归因**：归档 / 未登记类别 / 不在白名单 / 未进生成物 / 恒保留 五类各自命中
 *
 * ⚠️ 本测试**不手写**任何工具名单（除 `ARCHIVED_MISC_TOOLS` / `MANDATORY_TOOLS` 这两个真源），
 * 一律从常量表 / 生成物 / 报表自身派生（CS01）。
 */

import { describe, expect, it } from 'bun:test';
import {
  ARCHIVED_MISC_TOOLS,
  MANDATORY_TOOLS,
  filterToolsByTask,
} from '../../src/tools/toolCategories';
import { TOOL_NAME_CONSTANTS } from '../../src/tools/toolNameConstants';
import { TOOL_NAMES } from '../../src/constants/toolNames.generated';
import {
  isKnownToolCategory,
  resolveToolVisibilityReport,
} from '../../src/tools/toolVisibilityReport';
import type { ToolVisibilityReport } from '../../src/tools/toolVisibilityReport';

const ALL_NAMES = Object.values(TOOL_NAME_CONSTANTS);
const report = resolveToolVisibilityReport();
const byName = new Map<string, ToolVisibilityReport>(
  report.map((r) => [r.name, r])
);

describe('P1 工具可见性报表', () => {
  it('覆盖全部常量名（90）· 名字唯一 · 升序稳定', () => {
    expect(report.length).toBe(ALL_NAMES.length);
    expect(new Set(report.map((r) => r.name)).size).toBe(ALL_NAMES.length);
    const sorted = [...report.map((r) => r.name)].sort();
    expect(report.map((r) => r.name)).toEqual(sorted);
  });

  it('自洽：hidden 必带原因；visible 的原因或为空、或仅 mandatory', () => {
    for (const r of report) {
      if (r.effective === 'hidden') {
        expect(r.visibleByDefault).toBe(false);
        expect(r.reasons.length).toBeGreaterThan(0);
      } else {
        expect(r.visibleByDefault).toBe(true);
        const nonMandatory = r.reasons.filter((x) => x !== 'mandatory');
        expect(nonMandatory).toEqual([]);
      }
    }
  });

  it('与 filterToolsByTask 全量交叉一致（防口径漂移的主闸）', () => {
    // 只对**生效面**（生成物 75）交叉：它们才可能真的进工具清单
    for (const name of TOOL_NAMES) {
      const entry = byName.get(name);
      expect(entry).toBeDefined();
      const kept = filterToolsByTask([{ name }], 'default').length === 1;
      expect(entry!.visibleByDefault).toBe(kept);
    }
  });

  it('归档集（browser / computer_use）⇒ archived 且不可见', () => {
    for (const name of ARCHIVED_MISC_TOOLS) {
      const entry = byName.get(name);
      expect(entry).toBeDefined();
      expect(entry!.reasons).toContain('archived');
      expect(entry!.effective).toBe('hidden');
    }
  });

  it('恒保留集 ⇒ 可见且原因为 mandatory（即便类别不在白名单）', () => {
    for (const name of MANDATORY_TOOLS) {
      const entry = byName.get(name);
      expect(entry).toBeDefined();
      expect(entry!.effective).toBe('visible');
      expect(entry!.reasons).toEqual(['mandatory']);
    }
  });

  it('未进生成物者 ⇒ conditional 且**恒不可见**（差集从生成物派生，不手写）', () => {
    const registered = new Set<string>(TOOL_NAMES);
    const notGenerated = ALL_NAMES.filter((n) => !registered.has(n));
    expect(notGenerated.length).toBeGreaterThan(0); // 现状 15 个
    for (const name of notGenerated) {
      const entry = byName.get(name);
      expect(entry!.registration).toBe('conditional');
      expect(entry!.reasons).toContain('conditional');
      expect(entry!.effective).toBe('hidden');
    }
    // 反向：生成物内的名字都不得被判 conditional
    for (const name of TOOL_NAMES) {
      expect(byName.get(name)!.registration).toBe('registered');
    }
  });

  it('未登记类别 ⇒ unregistered-category（且非归档）', () => {
    const unregistered = report.filter((r) =>
      r.reasons.includes('unregistered-category')
    );
    for (const r of unregistered) {
      expect(r.category).toBe('misc');
      expect(ARCHIVED_MISC_TOOLS.has(r.name)).toBe(false);
    }
  });

  it('任务白名单会改判：code 类在 coding 可见、在 default 不可见（类别从报表自取）', () => {
    const codeTool = resolveToolVisibilityReport().find(
      (r) => r.category === 'code' && r.registration === 'registered'
    );
    expect(codeTool).toBeDefined();
    expect(codeTool!.effective).toBe('hidden'); // default 白名单无 'code'
    expect(codeTool!.reasons).toContain('not-in-task-whitelist');

    const inCoding = resolveToolVisibilityReport({ taskType: 'coding' }).find(
      (r) => r.name === codeTool!.name
    );
    expect(inCoding!.effective).toBe('visible');
  });

  it('extraCategories 会改判：追加 image 后 image 类工具转为可见', () => {
    const imgTool = report.find(
      (r) => r.category === 'image' && r.registration === 'registered'
    );
    expect(imgTool).toBeDefined();
    expect(imgTool!.effective).toBe('hidden'); // default 白名单无 'image'

    const withImage = resolveToolVisibilityReport({
      extraCategories: ['image'],
    }).find((r) => r.name === imgTool!.name);
    expect(withImage!.effective).toBe('visible');
  });

  it('纯函数：同参两次结果深相等（确定性）', () => {
    expect(resolveToolVisibilityReport()).toEqual(report);
    expect(
      resolveToolVisibilityReport({
        taskType: 'agent',
        extraCategories: ['not-a-category' as never],
      })
    ).toEqual(
      resolveToolVisibilityReport({
        taskType: 'agent',
        extraCategories: ['not-a-category' as never],
      })
    );
  });

  it('isKnownToolCategory：只放行派生自 TASK_TOOL_CATEGORIES 的类别', () => {
    expect(isKnownToolCategory('image')).toBe(true);
    // `misc` 是 `getToolCategory()` 的**兜底类别**、从不出现在任何任务白名单里
    // ⇒ 不作为合法入参放行（否则等于给"未登记/归档"工具开一条旁路）
    expect(isKnownToolCategory('misc')).toBe(false);
    expect(isKnownToolCategory('not-a-category')).toBe(false);
    expect(isKnownToolCategory('')).toBe(false);
  });
});
