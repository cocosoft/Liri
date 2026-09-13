/**
 * 依赖图内核测试（评审修订 v4 阶段 1）
 * 覆盖：topoSort 加载序 / detectCycles / computeClosure / normalize 判定表 /
 * getServiceProviderPluginId / 服务级环等价性（与迁移前 PluginDependencyManager 输出一致）
 */
import { describe, test, expect } from 'bun:test';
import {
  topoSort,
  detectCycles,
  computeClosure,
  findReverseDependents,
  normalizeDependency,
  getServiceProviderPluginId,
  checkServiceCircularDependencies,
  buildPluginEdges,
  type DependencyEdge,
} from '../utils/dependencyResolver';
import { PluginDependencyManager } from '../management/PluginDependencyManager';
import { verifyAndDemote } from '../utils/dependencyResolver';
import { PluginHotloadManager } from '../hotload/PluginHotloadManager';

describe('topoSort（加载序：依赖先）', () => {
  test('依赖方排在被依赖方之后', () => {
    // A 依赖 B，B 依赖 C → 加载序 [C, B, A]
    const edges: DependencyEdge[] = [
      { from: 'A', to: 'B', kind: 'plugin' },
      { from: 'B', to: 'C', kind: 'plugin' },
    ];
    const sorted = topoSort(edges);
    expect(sorted.indexOf('C')).toBeLessThan(sorted.indexOf('B'));
    expect(sorted.indexOf('B')).toBeLessThan(sorted.indexOf('A'));
  });

  test('service 边被忽略', () => {
    const edges: DependencyEdge[] = [
      { from: 'A', to: 'B', kind: 'plugin' },
      { from: 'C', to: 'svcX', kind: 'service' },
    ];
    const sorted = topoSort(edges);
    expect(sorted).not.toContain('svcX');
  });
});

describe('detectCycles', () => {
  test('检出环', () => {
    const edges: DependencyEdge[] = [
      { from: 'A', to: 'B', kind: 'plugin' },
      { from: 'B', to: 'A', kind: 'plugin' },
    ];
    expect(detectCycles(edges).length).toBeGreaterThan(0);
  });

  test('无环返回空', () => {
    const edges: DependencyEdge[] = [
      { from: 'A', to: 'B', kind: 'plugin' },
      { from: 'B', to: 'C', kind: 'plugin' },
    ];
    expect(detectCycles(edges)).toEqual([]);
  });
});

describe('computeClosure（依赖先序）', () => {
  test('闭包包含依赖链', () => {
    const edges: DependencyEdge[] = [
      { from: 'A', to: 'B', kind: 'plugin' },
      { from: 'B', to: 'C', kind: 'plugin' },
    ];
    const result = computeClosure('A', edges);
    expect('closure' in result).toBe(true);
    const closure = 'closure' in result ? result.closure : [];
    expect(closure).toContain('A');
    expect(closure).toContain('B');
    expect(closure).toContain('C');
  });

  test('环返回 CYCLE_DETECTED', () => {
    const edges: DependencyEdge[] = [
      { from: 'A', to: 'B', kind: 'plugin' },
      { from: 'B', to: 'A', kind: 'plugin' },
    ];
    const result = computeClosure('A', edges);
    expect('code' in result && result.code === 'CYCLE_DETECTED').toBe(true);
  });
});

describe('normalizeDependency（判定表）', () => {
  test('裸名 → { name, version: "*" }', () => {
    expect(normalizeDependency('pluginA')).toEqual({
      name: 'pluginA',
      version: '*',
      marketplace: undefined,
    });
  });

  test('对象声明保留 version', () => {
    expect(normalizeDependency({ name: 'B', version: '^1.0.0' })).toEqual({
      name: 'B',
      version: '^1.0.0',
    });
  });

  test('name@version 歧义被 validate 拒绝', () => {
    const result = normalizeDependency('plugin@^1.0.0');
    expect('code' in result && result.code === 'INVALID_IDENTIFIER').toBe(true);
  });

  test('非法输入被拒绝', () => {
    for (const bad of ['a@', '@b', '']) {
      const result = normalizeDependency(bad);
      expect('code' in result && result.code === 'INVALID_IDENTIFIER').toBe(
        true
      );
    }
  });
});

describe('getServiceProviderPluginId', () => {
  test('非 kernel.* 服务名首段即提供者', () => {
    expect(getServiceProviderPluginId('myPlugin.services.search')).toBe(
      'myPlugin'
    );
  });

  test('kernel.* 系统服务返回 undefined', () => {
    expect(getServiceProviderPluginId('kernel.configManager')).toBeUndefined();
  });
});

describe('服务级环等价性（与迁移前 PluginDependencyManager 输出一致）', () => {
  test('A↔B 互 inject 成环，内核与旧实现均检出', () => {
    const pluginInjectMap = new Map<string, string[]>([
      ['pluginA', ['pluginB.service.search']],
      ['pluginB', ['pluginA.service.index']],
    ]);

    const coreResult = checkServiceCircularDependencies(pluginInjectMap);
    const manager = new PluginDependencyManager();
    const legacyResult =
      manager.checkServiceCircularDependencies(pluginInjectMap);

    expect(coreResult.length).toBeGreaterThan(0);
    // 等价性：内核检出环的扁平节点集合与旧实现一致
    expect(new Set(coreResult.flat())).toEqual(new Set(legacyResult.flat()));
  });

  test('纯系统服务无环', () => {
    const pluginInjectMap = new Map<string, string[]>([
      ['pluginA', ['kernel.configManager']],
    ]);
    expect(checkServiceCircularDependencies(pluginInjectMap)).toEqual([]);
  });
});

describe('buildPluginEdges（key 统一为裸名）', () => {
  test('从依赖声明构建插件级边', () => {
    const edges = buildPluginEdges([
      { name: 'A', dependencies: ['B'] },
      { name: 'B', dependencies: ['C'] },
    ]);
    expect(edges).toContainEqual({ from: 'A', to: 'B', kind: 'plugin' });
    expect(edges).toContainEqual({ from: 'B', to: 'C', kind: 'plugin' });
  });
});

describe('findReverseDependents', () => {
  test('返回依赖指定插件的插件', () => {
    const edges: DependencyEdge[] = [
      { from: 'A', to: 'B', kind: 'plugin' },
      { from: 'C', to: 'B', kind: 'plugin' },
    ];
    expect(findReverseDependents('B', edges).sort()).toEqual(['A', 'C']);
  });
});

describe('verifyAndDemote（加载期安全降级）', () => {
  const makePlugin = (
    overrides: Partial<{
      source: string;
      name: string;
      enabled: boolean;
      deps: string[];
    }>
  ) => ({
    source: overrides.source ?? 'p',
    name: overrides.name ?? overrides.source ?? 'p',
    enabled: overrides.enabled ?? true,
    manifest: { dependencies: overrides.deps ?? [] },
  });

  test('依赖满足时零降级（幂等性，防误伤）', () => {
    const plugins = [
      makePlugin({ source: 'A', deps: ['B'] }),
      makePlugin({ source: 'B' }),
    ];
    const result = verifyAndDemote(plugins as never);
    expect(result.demoted.size).toBe(0);
    expect(result.errors).toEqual([]);
  });

  test('依赖缺失时插件被降级', () => {
    const plugins = [
      makePlugin({ source: 'A', deps: ['missing-plugin'] }),
      makePlugin({ source: 'B' }),
    ];
    const result = verifyAndDemote(plugins as never);
    expect(result.demoted.has('A')).toBe(true);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('热加载排序（内核 subgraph 排序与 getUnloadOrder 一致）', () => {
  test('依赖方先卸载', () => {
    const hm = new PluginHotloadManager({ enabled: false });
    // A 依赖 B，B 依赖 C → 卸载序 [A, B, C]（依赖方先）
    hm.buildDependencyGraph({
      A: ['B'],
      B: ['C'],
    });
    const order = hm.getUnloadOrder('C');
    expect(order.indexOf('A')).toBeLessThan(order.indexOf('B'));
    expect(order.indexOf('B')).toBeLessThan(order.indexOf('C'));
    expect(order).toContain('C');
  });

  test('可达子图限定：仅卸载依赖方，不影响无关插件', () => {
    const hm = new PluginHotloadManager({ enabled: false });
    hm.buildDependencyGraph({
      A: ['B'],
      B: ['C'],
      X: [], // 无关插件
    });
    const order = hm.getUnloadOrder('C');
    expect(order).toEqual(['A', 'B', 'C']);
    expect(order).not.toContain('X');
  });
});
