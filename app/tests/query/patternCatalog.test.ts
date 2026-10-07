// MIT License
// Copyright (c) 2026 190615273@qq.com
/**
 * PC-6（2026-10-07）：编排模式**只读目录**守卫（`listPatternCatalog`）
 *
 * 锁四件事：
 *   ① 覆盖注册表**全部** pattern（数量与声明序一致，不多不少）；
 *   ② 每条都带展示所需字段（显示名 / 适用场景 / 角色 / 绑定 / assembler）；
 *   ③ **装配状态自洽**：`ready` ⇒ 有 `route` 且无 `reason`；`unavailable` ⇒ 有非空 `reason`；
 *   ④ 冻结**当前实况**（哪些已接线、哪些未接线）—— 接线状态变化必须显式改本用例。
 */
import { describe, it, expect } from 'bun:test';

import { listPatternCatalog } from '../../src/query/patternAssembler.js';
import { listPatterns } from '../../src/core/patterns/index.js';

describe('listPatternCatalog（PC-6 编排模式目录）', () => {
  it('① 覆盖注册表全部 pattern，且顺序 = 声明序', () => {
    const catalog = listPatternCatalog();
    expect(catalog.map((c) => c.name)).toEqual(
      listPatterns().map((p) => p.name)
    );
  });

  it('② 展示字段齐备（显示名 / 适用场景 / 角色 / 绑定 / assembler）', () => {
    for (const c of listPatternCatalog()) {
      expect(c.displayName.length).toBeGreaterThan(0);
      expect(c.when.length).toBeGreaterThan(0);
      expect(c.roles.length).toBeGreaterThan(0);
      expect(c.bindings.length).toBeGreaterThan(0);
      expect(c.assembler.length).toBeGreaterThan(0);
      // 绑定角色与 roles 一一对应（注册表不变量在目录层同样成立）
      expect(c.bindings.map((b) => b.role).sort()).toEqual([...c.roles].sort());
      for (const b of c.bindings) expect(b.providers.length).toBeGreaterThan(0);
    }
  });

  it('③ 装配状态自洽：ready ⇒ route 无 reason；unavailable ⇒ 非空 reason', () => {
    for (const c of listPatternCatalog()) {
      if (c.status === 'ready') {
        expect(typeof c.route).toBe('string');
        expect(c.reason).toBeUndefined();
      } else {
        expect(c.route).toBeUndefined();
        expect((c.reason ?? '').length).toBeGreaterThan(0);
      }
    }
  });

  it('④ 冻结当前实况（接线状态变化须显式改本用例）', () => {
    const byName = Object.fromEntries(
      listPatternCatalog().map((c) => [c.name, c])
    );
    // 已接线（有可执行路由）
    expect(byName.competitive_strategy.status).toBe('ready');
    expect(byName.competitive_strategy.route).toBe('research');
    expect(byName.self_verify.status).toBe('ready');
    expect(byName.self_verify.route).toBe('verify');
    // 未接线（如实登记，含原因）
    expect(byName.long_task_pdl.status).toBe('unavailable');
    expect(byName.iterative_refine.status).toBe('unavailable');
    expect(byName.parallel_distributed.status).toBe('unavailable');
  });

  it('目录是副本：改动返回值不影响注册表', () => {
    const catalog = listPatternCatalog();
    catalog[0].roles.push('__mutated__');
    catalog[0].bindings[0].providers.push('__mutated__');
    expect(listPatternCatalog()[0].roles).not.toContain('__mutated__');
    expect(listPatternCatalog()[0].bindings[0].providers).not.toContain(
      '__mutated__'
    );
  });
});
