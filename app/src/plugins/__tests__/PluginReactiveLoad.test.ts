/**
 * 响应式加载（4.4）集成测试：inject 缺失服务 → 挂起；服务注册后重试激活
 * 评审修订 v4：补「SDK 插件不受 verifyAndDemote 影响」与「demoteOnLoad 开关」用例
 */
import { describe, test, expect } from 'bun:test';
import { PluginSystem } from '../index';
import { KernelServiceId } from '../api/KernelServiceRegistry';
import { createPlugin } from '../../plugin-sdk/core';

describe('PluginSystem 响应式加载（4.4）', () => {
  test('inject 缺失必需服务 → 挂起等待；服务注册后重试激活', async () => {
    const ps = new PluginSystem();
    await ps.initialize();
    const registry = ps.getKernelRegistry();
    expect(registry).not.toBeNull();

    const plugin = createPlugin({
      id: 'reactive-plugin',
      name: 'Reactive',
      version: '1.0.0',
      description: '',
      author: 'demo',
      category: 'tool',
      inject: ['kernel.reactiveService'],
      activate: async () => {},
    });

    // 服务未注册 → 挂起（不抛错）
    await ps.registerPluginFromSDK(plugin);
    const pending = ps.getPendingSdkPlugins();
    expect(pending).toHaveLength(1);
    expect(pending[0].pluginId).toBe('reactive-plugin');
    expect(pending[0].missing).toEqual(['kernel.reactiveService']);
    expect(pending[0].state).toBe('pending');

    // 手动重试：服务仍未注册 → 保持挂起
    const retried = await ps.retryPendingSdkPlugin('reactive-plugin');
    expect(retried).toBe(false);
    expect(ps.getPendingSdkPlugins()).toHaveLength(1);

    // 注册缺失服务 → 重试成功 → 插件激活
    registry!.register('kernel.reactiveService' as KernelServiceId, {
      name: 'reactive',
    });
    const ok = await ps.retryPendingSdkPlugin('reactive-plugin');
    expect(ok).toBe(true);
    expect(ps.getPendingSdkPlugins()).toHaveLength(0);

    await ps.destroy();
  });

  test('inject 服务已注册 → 直接完成注册（不挂起）', async () => {
    const ps = new PluginSystem();
    await ps.initialize();

    const plugin = createPlugin({
      id: 'direct-plugin',
      name: 'Direct',
      version: '1.0.0',
      description: '',
      author: 'demo',
      category: 'tool',
      inject: ['kernel.configManager'],
    });

    await ps.registerPluginFromSDK(plugin);
    expect(ps.getPendingSdkPlugins()).toHaveLength(0);
    expect(ps.getAllSkills()).toHaveLength(0); // 无技能，注册成功无副作用

    await ps.destroy();
  });

  test('SDK 插件不受 verifyAndDemote 影响（评审修订 v4）', async () => {
    const ps = new PluginSystem();
    await ps.initialize();

    // SDK 插件（无 manifest.dependencies，走 registerPluginFromSDK 路径）
    const plugin = createPlugin({
      id: 'sdk-no-demote',
      name: 'SdkNoDemote',
      version: '1.0.0',
      description: '',
      author: 'demo',
      category: 'tool',
      activate: async () => {},
    });

    // demoteOnLoad 默认开启，但 SDK 插件不经过 verifyAndDemote（互不相交）
    await ps.registerPluginFromSDK(plugin);
    expect(ps.getPendingSdkPlugins()).toHaveLength(0);
    expect(ps.getAllSkills()).toHaveLength(0);

    await ps.destroy();
  });

  test('demoteOnLoad 开关：false 时构造正常且 SDK 路径不受影响（评审修订 v4）', async () => {
    const ps = new PluginSystem({}, { demoteOnLoad: false });
    await ps.initialize();

    const plugin = createPlugin({
      id: 'sdk-switch-off',
      name: 'SdkSwitchOff',
      version: '1.0.0',
      description: '',
      author: 'demo',
      category: 'tool',
      inject: ['kernel.configManager'],
    });

    await ps.registerPluginFromSDK(plugin);
    expect(ps.getPendingSdkPlugins()).toHaveLength(0);

    await ps.destroy();
  });

  test('demoteOnLoad 开关：默认开启（不传参时构造正常）', async () => {
    const ps = new PluginSystem();
    await ps.initialize();
    await ps.destroy();
  });
});
