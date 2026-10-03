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
