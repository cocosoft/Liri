/**
 * PluginLifecycleManager 插件级作用域测试（G2b，附录 C）
 *
 * 背景：plugins/core/PluginLifecycleManager 原为 EventEmitter + 手动钩子，
 * 未 EffectScope 化（与 agent/managers/PluginLoader 的 T3.4/T3.6 不对齐）。
 * 改造：startPlugin 创建插件级 EffectScope，stopPlugin = scope.dispose()（LIFO），
 * onPluginDispose 声明式登记逆操作（use-before-activate 防护）。
 */

import { describe, test, expect } from 'bun:test';
import { PluginLifecycleManager } from '../PluginLifecycleManager.js';
import { PluginState, LoadedPlugin } from '../../types/PluginTypes.js';

function makePlugin(id: string): LoadedPlugin {
  return {
    id,
    name: id,
    version: '1.0.0',
    state: PluginState.LOADED,
    path: `C:\\tmp\\${id}`,
    enabled: true,
    source: 'test',
  };
}

describe('PluginLifecycleManager 插件级作用域（G2b）', () => {
  test('onPluginDispose 登记的逆操作在 stopPlugin 时按 LIFO 释放', async () => {
    const mgr = new PluginLifecycleManager();
    mgr.registerPlugin(makePlugin('p1'));
    await mgr.startPlugin('p1');

    const order: string[] = [];
    mgr.onPluginDispose('p1', () => order.push('A'));
    mgr.onPluginDispose('p1', () => order.push('B'));

    await mgr.stopPlugin('p1');
    expect(order).toEqual(['B', 'A']); // LIFO
  });

  test('未激活插件 onPluginDispose → 抛错（use-before-activate 防护）', () => {
    const mgr = new PluginLifecycleManager();
    mgr.registerPlugin(makePlugin('p1'));
    expect(() => mgr.onPluginDispose('p1', () => {})).toThrow('not activated');
  });

  test('stopPlugin 幂等（重复停止不重复执行逆操作）', async () => {
    const mgr = new PluginLifecycleManager();
    mgr.registerPlugin(makePlugin('p1'));
    await mgr.startPlugin('p1');
    let count = 0;
    mgr.onPluginDispose('p1', () => count++);

    await mgr.stopPlugin('p1');
    await mgr.stopPlugin('p1'); // 已停止，scope 已移除，跳过
    expect(count).toBe(1);
  });

  test('stop 后重新装载可重建 scope（重新激活后可再登记）', async () => {
    const mgr = new PluginLifecycleManager();
    const plugin = makePlugin('p1');
    mgr.registerPlugin(plugin);
    await mgr.startPlugin('p1');
    mgr.onPluginDispose('p1', () => {});
    await mgr.stopPlugin('p1');

    // 模拟重新装载（state 回 LOADED 后重新激活 → 新 scope）
    plugin.state = PluginState.LOADED;
    await mgr.startPlugin('p1');
    let count = 0;
    mgr.onPluginDispose('p1', () => count++);
    await mgr.stopPlugin('p1');
    expect(count).toBe(1);
  });

  test('destroy 统一释放全部插件 scope', async () => {
    const mgr = new PluginLifecycleManager();
    mgr.registerPlugin(makePlugin('p1'));
    mgr.registerPlugin(makePlugin('p2'));
    await mgr.startAllPlugins();

    let released = 0;
    mgr.onPluginDispose('p1', () => released++);
    mgr.onPluginDispose('p2', () => released++);

    await mgr.destroy();
    expect(released).toBe(2);
  });
});
