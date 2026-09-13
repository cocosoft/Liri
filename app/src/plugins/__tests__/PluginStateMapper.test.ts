/**
 * PluginStateMapper + KernelServiceRegistry 事件 + 静态校验测试（报告 4.4）
 */
import { describe, test, expect } from 'bun:test';
import {
  mapPluginStateToStatus,
  mapPluginStatusToRuntime,
  mapPluginRuntimeToState,
  PLUGIN_PENDING_STATE,
} from '../core/PluginStateMapper';
import {
  KernelServiceRegistry,
  KernelServiceId,
} from '../api/KernelServiceRegistry';
import { PluginState, PluginType } from '../types/PluginTypes';
import { PluginStatus } from '../types/Plugin';
import { SdkPluginAdapter } from '../core/SdkPluginAdapter';
import { PluginDependencyManager } from '../management/PluginDependencyManager';
import { createPlugin } from '../../plugin-sdk/core';

describe('PluginStateMapper（三套状态机互映射 + PENDING）', () => {
  test('PluginState 8 态 → PluginStatus 5 态', () => {
    expect(mapPluginStateToStatus(PluginState.UNLOADED)).toBe(
      PluginStatus.REGISTERED
    );
    expect(mapPluginStateToStatus(PluginState.LOADED)).toBe(
      PluginStatus.LOADED
    );
    expect(mapPluginStateToStatus(PluginState.ACTIVATED)).toBe(
      PluginStatus.ENABLED
    );
    expect(mapPluginStateToStatus(PluginState.DEACTIVATED)).toBe(
      PluginStatus.DISABLED
    );
    expect(mapPluginStateToStatus(PluginState.FAILED)).toBe(PluginStatus.ERROR);
    // ACTIVATED 与 ENABLED 语义重叠：均视为已启用
    expect(mapPluginStateToStatus(PluginState.ENABLED)).toBe(
      PluginStatus.ENABLED
    );
  });

  test('PluginStatus 5 态 → PluginRuntimeStatus 6 态', () => {
    expect(mapPluginStatusToRuntime(PluginStatus.REGISTERED)).toBe('created');
    expect(mapPluginStatusToRuntime(PluginStatus.ENABLED)).toBe('active');
    expect(mapPluginStatusToRuntime(PluginStatus.ERROR)).toBe('error');
  });

  test('PluginRuntimeStatus 6 态 → PluginState 8 态', () => {
    expect(mapPluginRuntimeToState('active')).toBe(PluginState.ACTIVATED);
    expect(mapPluginRuntimeToState('error')).toBe(PluginState.FAILED);
    expect(mapPluginRuntimeToState('inactive')).toBe(PluginState.DEACTIVATED);
  });

  test('PENDING 在三套状态机间透传', () => {
    expect(mapPluginStateToStatus(PLUGIN_PENDING_STATE)).toBe(
      PLUGIN_PENDING_STATE
    );
    expect(mapPluginStatusToRuntime(PLUGIN_PENDING_STATE)).toBe(
      PLUGIN_PENDING_STATE
    );
    expect(mapPluginRuntimeToState(PLUGIN_PENDING_STATE)).toBe(
      PLUGIN_PENDING_STATE
    );
  });
});

describe('KernelServiceRegistry 服务注册事件（4.4 响应式基础）', () => {
  test('register() 发射 serviceRegistered 事件', () => {
    const registry = new KernelServiceRegistry();
    const received: unknown[] = [];

    registry.on(KernelServiceRegistry.SERVICE_REGISTERED, (data) => {
      received.push(data);
    });

    const instance = { name: 'config' };
    registry.register(KernelServiceId.CONFIG_MANAGER, instance);

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      serviceId: KernelServiceId.CONFIG_MANAGER,
      instance,
    });
  });

  test('每次 register 都触发事件（含覆盖注册）', () => {
    const registry = new KernelServiceRegistry();
    let count = 0;
    registry.on(KernelServiceRegistry.SERVICE_REGISTERED, () => {
      count++;
    });

    registry.register(KernelServiceId.EVENT_SYSTEM, { a: 1 });
    registry.register(KernelServiceId.EVENT_SYSTEM, { a: 2 });

    expect(count).toBe(2);
  });
});

describe('静态校验层（validateProviderDependencies）', () => {
  test('系统服务（kernel.*）跳过提供者校验', () => {
    const registry = new KernelServiceRegistry();
    const adapter = new SdkPluginAdapter(registry);

    const plugin = createPlugin({
      id: 'p',
      name: 'P',
      version: '1.0.0',
      description: '',
      author: 'demo',
      category: 'tool',
      inject: ['kernel.configManager'],
    });

    expect(adapter.validateProviderDependencies(plugin)).toEqual([]);
  });

  test('第三方服务未声明提供者插件时报 warning 并返回缺失列表', () => {
    const registry = new KernelServiceRegistry();
    const adapter = new SdkPluginAdapter(registry);

    const plugin = createPlugin({
      id: 'p',
      name: 'P',
      version: '1.0.0',
      description: '',
      author: 'demo',
      category: 'tool',
      inject: ['myPlugin.services.search'],
    });

    expect(adapter.validateProviderDependencies(plugin)).toEqual([
      'myPlugin.services.search',
    ]);
  });

  test('第三方服务已声明提供者插件（dependencies）时通过', () => {
    const registry = new KernelServiceRegistry();
    const adapter = new SdkPluginAdapter(registry);

    const plugin = createPlugin({
      id: 'p',
      name: 'P',
      version: '1.0.0',
      description: '',
      author: 'demo',
      category: 'tool',
      inject: ['myPlugin.services.search'],
      dependencies: ['myPlugin'],
    });

    expect(adapter.validateProviderDependencies(plugin)).toEqual([]);
  });
});

describe('服务级循环依赖检测（checkServiceCircularDependencies，4.4）', () => {
  test('插件名级无环但服务级成环时被检测', () => {
    const manager = new PluginDependencyManager();

    // A inject B 提供的服务，B inject A 提供的服务——服务级环
    const pluginInjectMap = new Map<string, string[]>([
      ['pluginA', ['pluginB.service.search']],
      ['pluginB', ['pluginA.service.index']],
    ]);

    const cycles = manager.checkServiceCircularDependencies(pluginInjectMap);
    expect(cycles.length).toBeGreaterThan(0);
    // 环内应包含 A 与 B
    const flattened = cycles.flat();
    expect(flattened).toContain('pluginA');
    expect(flattened).toContain('pluginB');
  });

  test('仅 kernel.* 系统服务时不构成环', () => {
    const manager = new PluginDependencyManager();

    const pluginInjectMap = new Map<string, string[]>([
      ['pluginA', ['kernel.configManager']],
      ['pluginB', ['kernel.eventSystem']],
    ]);

    const cycles = manager.checkServiceCircularDependencies(pluginInjectMap);
    expect(cycles).toEqual([]);
  });

  test('单向依赖不构成环', () => {
    const manager = new PluginDependencyManager();

    const pluginInjectMap = new Map<string, string[]>([
      ['pluginA', ['pluginB.service.search']],
      ['pluginB', ['kernel.configManager']],
    ]);

    const cycles = manager.checkServiceCircularDependencies(pluginInjectMap);
    expect(cycles).toEqual([]);
  });
});

describe('satisfiesVersion ^ 语义修复（2.1 gap 3：复用 utils/semver）', () => {
  test('^1.0.0 拒绝 2.x（修复前允许 2.x 通过）', () => {
    const manager = new PluginDependencyManager();

    // B 有 1.5.0 与 2.0.0 两个版本；A 依赖 B ^1.0.0
    manager.addPlugin({
      id: 'b-2x',
      name: 'B',
      version: '2.0.0',
      description: '',
      author: '',
      type: PluginType.TOOL,
    });
    manager.addPlugin({
      id: 'b-1x',
      name: 'B',
      version: '1.5.0',
      description: '',
      author: '',
      type: PluginType.TOOL,
    });
    manager.addPlugin({
      id: 'a',
      name: 'A',
      version: '1.0.0',
      description: '',
      author: '',
      type: PluginType.TOOL,
      dependencies: [{ name: 'B', version: '^1.0.0' }],
    });

    const result = manager.resolveDependencies('A');
    expect(result.success).toBe(true);
    // ^1.0.0 应匹配 1.x（选 1.5.0），不产生版本冲突
    expect(result.versionConflicts).toEqual([]);
    // 依赖链为声明格式：B@^1.0.0（解析结果为 1.5.0，而非 2.0.0）
    expect(result.dependencyChain).toContain('B@^1.0.0');
  });

  test('~1.0.0 拒绝 1.2.x（主次版本约束）', () => {
    const manager = new PluginDependencyManager();

    manager.addPlugin({
      id: 'b',
      name: 'B',
      version: '1.2.0',
      description: '',
      author: '',
      type: PluginType.TOOL,
    });
    manager.addPlugin({
      id: 'a',
      name: 'A',
      version: '1.0.0',
      description: '',
      author: '',
      type: PluginType.TOOL,
      dependencies: [{ name: 'B', version: '~1.0.0' }],
    });

    const result = manager.resolveDependencies('A');
    expect(result.success).toBe(false);
    // 缺失依赖以声明格式记录：B@~1.0.0（B@1.2.0 不满足 ~1.0.0）
    expect(result.missingDependencies).toContain('B@~1.0.0');
  });
});
