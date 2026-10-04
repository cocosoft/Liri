// MIT License
// Copyright (c) 2026 190615273@qq.com
// pattern 承担方解析层契约用例（T-①04 T1-3 · 方案 A）
//
// 覆盖 spec §7-3「闭集枚举与注册表无悬空 provider」：
//   ① 闭集 ↔ 绑定表双向一致（findUnboundProviders 恒空）；
//   ② 注册表 5 个 pattern 的 assembly.bindings 引用的每个 provider 均可解析到实现定位。

import { describe, expect, it } from 'bun:test';
import {
  PATTERN_PROVIDER_BINDINGS,
  resolvePatternProvider,
  resolveAssemblyProviders,
  findUnboundProviders,
} from '../../src/query/patternAssembly';
import { instantiatePattern } from '../../src/query/patternAssembler';
import {
  selectPattern,
  listPatterns,
  getPatternDescriptor,
} from '../../src/core/patterns/index';
import { PATTERN_PROVIDERS } from '../../src/core/patterns/types';
import { PATTERN_DESCRIPTORS } from '../../src/core/patterns/PatternRegistry';

describe('pattern 承担方解析层（A）：闭集无悬空', () => {
  it('闭集 ↔ 绑定表双向一致（无漏配、无闭集外键）', () => {
    expect(findUnboundProviders()).toEqual([]);
    // 逐项显式核对（避免"函数恒返回空"却掩盖漏配）
    for (const id of PATTERN_PROVIDERS) {
      expect(PATTERN_PROVIDER_BINDINGS[id]).toBeDefined();
    }
    expect(Object.keys(PATTERN_PROVIDER_BINDINGS).sort()).toEqual(
      [...PATTERN_PROVIDERS].sort()
    );
  });

  it('每个闭集 provider 解析到非空的实现定位（impl + locator）', () => {
    for (const id of PATTERN_PROVIDERS) {
      const binding = resolvePatternProvider(id);
      expect(binding.impl.length).toBeGreaterThan(0);
      expect(binding.locator.length).toBeGreaterThan(0);
    }
  });
});

describe('pattern 承担方解析层（A）：注册表引用全覆盖', () => {
  it('注册表每个 binding 引用的 provider 均可解析（角色数 = 展开数）', () => {
    for (const descriptor of Object.values(PATTERN_DESCRIPTORS)) {
      const expanded = resolveAssemblyProviders(descriptor.assembly);
      const bindingCount = descriptor.assembly.bindings.reduce(
        (n, b) => n + b.providers.length,
        0
      );
      expect(expanded.length).toBe(bindingCount);
      for (const item of expanded) {
        expect(item.role.length).toBeGreaterThan(0);
        expect(item.binding.impl.length).toBeGreaterThan(0);
        // 角色必须 ∈ descriptor.roles（注册表自检已有，双保险）
        expect(descriptor.roles).toContain(item.role);
      }
    }
  });

  it('registry 引用的 provider 集合是闭集子集（无闭集外引用）', () => {
    const closedSet = new Set<string>(PATTERN_PROVIDERS);
    for (const descriptor of Object.values(PATTERN_DESCRIPTORS)) {
      for (const b of descriptor.assembly.bindings) {
        for (const provider of b.providers) {
          expect(closedSet.has(provider)).toBe(true);
        }
      }
    }
  });
});

// A8 最后一公里（B1，2026-10-04，pattern-assembly-runtime.md §4.1）：
// 装配入口 instantiatePattern —— assembler → 可执行路由（未接线者显式 unavailable）
describe('pattern 装配入口（B1）：assembler → 可执行路由', () => {
  it('competitive_strategy → ready/research（复用 A7 装配点，不新增构造）', () => {
    const sel = selectPattern({ complexity: 'complex', research: true });
    if (!sel) throw new Error('研究型 complex 应选中 competitive_strategy');
    const inst = instantiatePattern(sel);
    expect(inst.status).toBe('ready');
    expect(inst.assembler).toBe('competitive_strategy');
    if (inst.status === 'ready') {
      expect(inst.route).toBe('research');
    }
  });

  // D4（2026-10-04，pattern-trigger-surfaces.md §5）：selectPattern 不再产出 long_task_pdl
  // ⇒ 直接经描述构造 selection 断言其装配结果（运行时由快速路径策略独立驱动）。
  it('long_task_pdl → unavailable（运行时由快速路径策略独立驱动，D2/D4）', () => {
    const descriptor = getPatternDescriptor('long_task_pdl');
    if (!descriptor) throw new Error('缺少 long_task_pdl 描述');
    const inst = instantiatePattern({ name: 'long_task_pdl', descriptor });
    expect(inst.status).toBe('unavailable');
    expect(inst.assembler).toBe('long_task_pdl');
    if (inst.status === 'unavailable') {
      expect(inst.reason.length).toBeGreaterThan(0);
      expect(inst.reason).toContain('PlanDrivenLoop');
    }
  });

  it('三个未落地 pattern → unavailable 且原因非空（fail-closed，无占位 stub）', () => {
    for (const name of [
      'iterative_refine',
      'parallel_distributed',
      'self_verify',
    ] as const) {
      const descriptor = getPatternDescriptor(name);
      if (!descriptor) throw new Error(`缺少 pattern 描述：${name}`);
      const inst = instantiatePattern({ name, descriptor });
      expect(inst.status).toBe('unavailable');
      expect(inst.assembler).toBe(name);
      if (inst.status === 'unavailable') {
        expect(inst.reason.length).toBeGreaterThan(0);
      }
    }
  });

  it('闭集全覆盖：5 个 pattern 均可装配（ready | unavailable，无异常/无 undefined）', () => {
    const patterns = listPatterns();
    expect(patterns).toHaveLength(5);
    for (const descriptor of patterns) {
      const inst = instantiatePattern({
        name: descriptor.name,
        descriptor,
      });
      expect(['ready', 'unavailable']).toContain(inst.status);
      // assembler 必须回传选择结果里的装配入口标识（消费方据它判定去向）
      expect(inst.assembler).toBe(descriptor.assembly.assembler);
    }
  });
});
