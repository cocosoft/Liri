/**
 * 运行期工具元数据（C3，2026-11-21；治理方案 v3 §14.3 / §14.6）
 *
 * 覆盖三处必需接线（缺一即"注册了但模型看不见 / 设置改不了 / 报表没有"）：
 * 1. `getToolCategory()` 查运行期登记（否则落 `misc` 被静默裁剪）；
 * 2. 可见性覆写的"已知工具名"判定（否则插件工具名被当未知丢弃）；
 * 3. 可见性报表的遍历域（否则设置页看不到插件工具）。
 */
import { afterEach, describe, expect, it } from 'bun:test';

import {
  getRuntimeToolMeta,
  listRuntimeToolNames,
  registerRuntimeToolMeta,
  resetRuntimeToolMetaForTest,
  unregisterRuntimeToolMeta,
} from '../../src/tools/runtimeToolMeta';
import {
  filterToolsByTask,
  getToolCategory,
  isInDefaultDisclosure,
} from '../../src/tools/toolCategories';
import {
  isKnownToolName,
  normalizeToolVisibilityOverrides,
} from '../../src/tools/toolVisibilityOverrides';
import { resolveToolVisibilityReport } from '../../src/tools/toolVisibilityReport';

const NAME = 'test_plugin_tool';

afterEach(() => {
  resetRuntimeToolMetaForTest();
});

describe('runtimeToolMeta：登记 / 撤销', () => {
  it('登记后可查、可列出（升序）', () => {
    registerRuntimeToolMeta('b_tool', { category: 'plugin', pack: 'p1' });
    registerRuntimeToolMeta('a_tool', { category: 'plugin', pack: 'p1' });
    expect(getRuntimeToolMeta('b_tool')?.pack).toBe('p1');
    expect(listRuntimeToolNames()).toEqual(['a_tool', 'b_tool']);
  });

  it('disposer 只撤销自己那次登记（后登记者覆盖后不被误删）', () => {
    const disposeFirst = registerRuntimeToolMeta(NAME, {
      category: 'plugin',
      pack: 'first',
    });
    registerRuntimeToolMeta(NAME, { category: 'file', pack: 'second' });
    disposeFirst();
    // 后登记者仍在（防 LIFO 误删）
    expect(getRuntimeToolMeta(NAME)?.pack).toBe('second');
  });

  it('disposer 幂等 + 注销返回是否确有登记', () => {
    const dispose = registerRuntimeToolMeta(NAME, {
      category: 'plugin',
      pack: 'p',
    });
    dispose();
    dispose();
    expect(getRuntimeToolMeta(NAME)).toBeUndefined();
    expect(unregisterRuntimeToolMeta(NAME)).toBe(false);

    registerRuntimeToolMeta(NAME, { category: 'plugin', pack: 'p' });
    expect(unregisterRuntimeToolMeta(NAME)).toBe(true);
  });
});

describe('运行期登记 → 三处接线', () => {
  it('getToolCategory 优先查运行期登记；缺省类别为 `plugin`（不是 misc）', () => {
    registerRuntimeToolMeta(NAME, { category: 'plugin', pack: 'p' });
    expect(getToolCategory(NAME)).toBe('plugin');

    registerRuntimeToolMeta(NAME, { category: 'file', pack: 'p' });
    expect(getToolCategory(NAME)).toBe('file');
  });

  it('运行期工具不受默认披露白名单收窄（chat 面可见）', () => {
    registerRuntimeToolMeta(NAME, { category: 'plugin', pack: 'p' });
    expect(isInDefaultDisclosure(NAME)).toBe(true);
    expect(
      filterToolsByTask([{ name: NAME }], 'chat').map((t) => t.name)
    ).toEqual([NAME]);
  });

  it('可见性覆写认运行期工具名；卸载后条目失效', () => {
    expect(isKnownToolName(NAME)).toBe(false);
    expect(
      normalizeToolVisibilityOverrides({
        overrides: { [NAME]: 'on' },
      })
    ).toEqual({});

    registerRuntimeToolMeta(NAME, { category: 'plugin', pack: 'p' });
    expect(isKnownToolName(NAME)).toBe(true);
    expect(
      normalizeToolVisibilityOverrides({
        overrides: { [NAME]: 'on' },
      })
    ).toEqual({ [NAME]: 'on' });

    unregisterRuntimeToolMeta(NAME);
    expect(isKnownToolName(NAME)).toBe(false);
  });

  it('报表包含运行期工具（registered，非 conditional），带声明风险档位', () => {
    registerRuntimeToolMeta(NAME, {
      category: 'plugin',
      pack: 'p',
      riskClass: 'read',
    });
    const entry = resolveToolVisibilityReport({ taskType: 'chat' }).find(
      (e) => e.name === NAME
    );
    expect(entry).toBeDefined();
    expect(entry?.registration).toBe('registered');
    expect(entry?.visibleByDefault).toBe(true);
    expect(entry?.risk).toBe('low');
  });
});
