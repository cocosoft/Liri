// MIT License
// Copyright (c) 2026 190615273@qq.com
// PatchApplier 墓碑删除单测（验收标准 6：删除标记跨层测试）

import { describe, expect, it } from 'bun:test';
import { applyPatch, applyPatches } from '../../src/config/layers/PatchApplier';

describe('PatchApplier 墓碑删除（11.1 P0-3 决策，方案 C）', () => {
  it('普通 key 覆盖（深合并）', () => {
    const base = { ai: { defaultModel: 'a' }, server: { port: 8080 } };
    const { config } = applyPatch(base, { ai: { defaultModel: 'b' } });
    expect(config.ai.defaultModel).toBe('b');
    expect(config.server.port).toBe(8080); // 未涉及 key 保留
  });

  it('删除标记穿透低层值（跨层删除，验收标准 6）', () => {
    // 低层 bundle 定义了 ai.defaultModel，高层 patch 删除它
    const base = { ai: { defaultModel: 'deepseek-chat', providers: ['p1'] } };
    const { config, deletedKeys } = applyPatch(base, {
      ai: { defaultModel: null },
    });
    expect(config.ai.defaultModel).toBeUndefined(); // 物理移除，非 null
    expect('defaultModel' in (config.ai as object)).toBe(false);
    expect(config.ai.providers).toEqual(['p1']); // 兄弟 key 保留
    expect(deletedKeys).toEqual(['ai.defaultModel']);
  });

  it('嵌套删除：顶层对象整体删除', () => {
    const base = { ai: { a: 1 }, chat: { b: 2 } };
    const { config, deletedKeys } = applyPatch(base, { ai: null });
    expect(config.ai).toBeUndefined();
    expect(config.chat).toEqual({ b: 2 });
    expect(deletedKeys).toEqual(['ai']);
  });

  it('数组整体替换', () => {
    const base = { bundles: ['core', 'chat'] };
    const { config } = applyPatch(base, { bundles: ['core', 'ai'] });
    expect(config.bundles).toEqual(['core', 'ai']);
  });

  it('null 数组值（数组整体删除）', () => {
    const base = { list: [1, 2, 3] };
    const { config, deletedKeys } = applyPatch(base, { list: null });
    expect(config.list).toBeUndefined();
    expect(deletedKeys).toEqual(['list']);
  });

  it('标量/新 key 插入', () => {
    const base = { existing: 1 };
    const { config } = applyPatch(base, { newKey: 'v', flag: true });
    expect(config.newKey).toBe('v');
    expect(config.flag).toBe(true);
    expect(config.existing).toBe(1);
  });

  it('顺序多补丁（后层覆盖前层 + 删除聚合）', () => {
    const base = { ai: { defaultModel: 'a', provider: 'p1' } };
    const { config, deletedKeys } = applyPatches(base, [
      { ai: { defaultModel: 'b' } }, // patch1: 覆盖
      { ai: { defaultModel: null } }, // patch2: 删除（后层生效）
    ]);
    expect(config.ai.defaultModel).toBeUndefined();
    expect(config.ai.provider).toBe('p1');
    expect(deletedKeys).toEqual(['ai.defaultModel']);
  });

  it('不修改原 base 对象（不可变）', () => {
    const base = { ai: { defaultModel: 'a' } };
    const snapshot = JSON.stringify(base);
    applyPatch(base, { ai: { defaultModel: null } });
    expect(JSON.stringify(base)).toBe(snapshot);
  });
});
