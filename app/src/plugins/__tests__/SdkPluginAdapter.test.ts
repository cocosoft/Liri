/**
 * SdkPluginAdapter 测试（报告 4.0 方案 A 适配层）
 * 覆盖：inject 动态校验、自动授权、context services 注入、生命周期映射
 * PY-0：SDK 插件工具注册进全局单例 ToolRegistry
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import {
  KernelServiceRegistry,
  KernelServiceId,
} from '../api/KernelServiceRegistry';
import { SdkPluginAdapter } from '../core/SdkPluginAdapter';
import { createPlugin } from '../../plugin-sdk/core';
import type { Plugin as SdkPlugin } from '../../plugin-sdk/types';
import { getToolRegistry } from '../../tools/ToolRegistry';

describe('SdkPluginAdapter', () => {
  let registry: KernelServiceRegistry;
  let adapter: SdkPluginAdapter;

  beforeEach(() => {
    registry = new KernelServiceRegistry();
    registry.register(KernelServiceId.CONFIG_MANAGER, {
      name: 'configManager',
    });
    registry.register(KernelServiceId.EVENT_SYSTEM, { name: 'eventSystem' });
    adapter = new SdkPluginAdapter(registry);
  });

  describe('resolveInject（动态校验已注册服务目录）', () => {
    test('已注册服务被注入，未注册必需服务被标记缺失', () => {
      const plugin = createPlugin({
        id: 'p',
        name: 'P',
        version: '1.0.0',
        description: '',
        author: 'demo',
        category: 'tool',
        inject: ['kernel.configManager', 'kernel.missingService'],
        injectOptional: ['kernel.eventSystem', 'kernel.alsoMissing'],
      });

      const result = adapter.resolveInject(plugin);

      expect(result.services['kernel.configManager']).toEqual({
        name: 'configManager',
      });
      expect(result.services['kernel.eventSystem']).toEqual({
        name: 'eventSystem',
      });
      expect(result.missingRequired).toEqual(['kernel.missingService']);
      expect(result.missingOptional).toEqual(['kernel.alsoMissing']);
    });

    test('无 inject 声明时返回空结果', () => {
      const plugin = createPlugin({
        id: 'plain',
        name: 'Plain',
        version: '1.0.0',
        description: '',
        author: 'demo',
        category: 'tool',
      });

      const result = adapter.resolveInject(plugin);
      expect(result.services).toEqual({});
      expect(result.missingRequired).toEqual([]);
      expect(result.missingOptional).toEqual([]);
    });
  });

  describe('grantInjectedAccess（inject 声明即授权）', () => {
    test('为插件授予 inject 声明服务的访问权限', () => {
      const plugin = createPlugin({
        id: 'p',
        name: 'P',
        version: '1.0.0',
        description: '',
        author: 'demo',
        category: 'tool',
        inject: ['kernel.configManager'],
        injectOptional: ['kernel.eventSystem'],
      });

      adapter.grantInjectedAccess('p', plugin);

      expect(registry.hasAccess('p', KernelServiceId.CONFIG_MANAGER)).toBe(
        true
      );
      expect(registry.hasAccess('p', KernelServiceId.EVENT_SYSTEM)).toBe(true);
    });

    test('无 inject 声明时不产生授权', () => {
      const plugin = createPlugin({
        id: 'plain',
        name: 'Plain',
        version: '1.0.0',
        description: '',
        author: 'demo',
        category: 'tool',
      });

      adapter.grantInjectedAccess('plain', plugin);
      expect(registry.getAccessEntries()).toHaveLength(0);
    });
  });

  describe('createContext（services 以参数形式注入）', () => {
    test('services 挂载到 context.services 且可访问', () => {
      const plugin = createPlugin({
        id: 'p',
        name: 'P',
        version: '1.0.0',
        description: '',
        author: 'demo',
        category: 'tool',
      });

      const context = adapter.createContext(plugin, {
        'kernel.configManager': { name: 'configManager' },
      });

      expect(context.pluginId).toBe('p');
      expect(context.services?.has('kernel.configManager')).toBe(true);
      expect(context.services?.get('kernel.configManager')).toEqual({
        name: 'configManager',
      });
      expect(context.services?.list()).toEqual(['kernel.configManager']);
    });

    test('支持宿主传入 log/config/events/utils 覆盖默认空实现', () => {
      const plugin = createPlugin({
        id: 'p',
        name: 'P',
        version: '1.0.0',
        description: '',
        author: 'demo',
        category: 'tool',
      });

      const log = {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      };
      const context = adapter.createContext(plugin, {}, { log });

      expect(context.log).toBe(log);
    });
  });

  describe('runLifecycle（生命周期映射）', () => {
    test('按阶段调用 initialize/activate/deactivate/destroy', async () => {
      const calls: string[] = [];
      const plugin: SdkPlugin = {
        id: 'p',
        name: 'P',
        version: '1.0.0',
        description: '',
        author: 'demo',
        tags: [],
        category: 'tool',
        initialize: async () => {
          calls.push('initialize');
        },
        activate: async () => {
          calls.push('activate');
        },
        deactivate: async () => {
          calls.push('deactivate');
        },
        destroy: async () => {
          calls.push('destroy');
        },
      };
      const context = adapter.createContext(plugin, {});

      await adapter.runLifecycle('initialize', plugin, context);
      await adapter.runLifecycle('activate', plugin, context);
      await adapter.runLifecycle('deactivate', plugin, context);
      await adapter.runLifecycle('destroy', plugin, context);

      expect(calls).toEqual([
        'initialize',
        'activate',
        'deactivate',
        'destroy',
      ]);
    });

    test('未声明的钩子跳过执行', async () => {
      const plugin = createPlugin({
        id: 'plain',
        name: 'Plain',
        version: '1.0.0',
        description: '',
        author: 'demo',
        category: 'tool',
      });
      const context = adapter.createContext(plugin, {});

      await expect(
        adapter.runLifecycle('activate', plugin, context)
      ).resolves.toBeUndefined();
    });

    test('钩子抛出异常时包装为 AppError', async () => {
      const plugin: SdkPlugin = {
        id: 'fail',
        name: 'Fail',
        version: '1.0.0',
        description: '',
        author: 'demo',
        tags: [],
        category: 'tool',
        activate: async () => {
          throw new Error('boom');
        },
      };
      const context = adapter.createContext(plugin, {});

      await expect(
        adapter.runLifecycle('activate', plugin, context)
      ).rejects.toThrow(/SDK plugin fail activate failed: boom/);
    });
  });

  describe('静态校验层（validateProviderDependencies，评审修订 v4 提供者解析共用）', () => {
    test('kernel.* 系统服务跳过提供者校验', () => {
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

    test('第三方服务未声明提供者插件时返回缺失列表', () => {
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

  describe('可逆副作用（onDispose，4.3）', () => {
    test('onDispose 注册的逆操作按 LIFO 顺序释放', async () => {
      const plugin = createPlugin({
        id: 'dispose-p',
        name: 'Dispose',
        version: '1.0.0',
        description: '',
        author: 'demo',
        category: 'tool',
      });
      const context = adapter.createContext(plugin, {});
      const order: string[] = [];

      context.onDispose?.(() => {
        order.push('first');
      });
      context.onDispose?.(() => {
        order.push('second');
      });

      await adapter.releaseDisposers(plugin.id);

      // LIFO：后注册的 second 先执行
      expect(order).toEqual(['second', 'first']);
    });

    test('onDispose 未注册时释放为空操作', async () => {
      const plugin = createPlugin({
        id: 'no-dispose',
        name: 'NoDispose',
        version: '1.0.0',
        description: '',
        author: 'demo',
        category: 'tool',
      });
      adapter.createContext(plugin, {});

      await expect(
        adapter.releaseDisposers(plugin.id)
      ).resolves.toBeUndefined();
    });

    test('disposer 异常不阻断后续释放', async () => {
      const plugin = createPlugin({
        id: 'err-dispose',
        name: 'ErrDispose',
        version: '1.0.0',
        description: '',
        author: 'demo',
        category: 'tool',
      });
      const context = adapter.createContext(plugin, {});
      const reached: string[] = [];

      context.onDispose?.(async () => {
        throw new Error('disposer boom');
      });
      context.onDispose?.(() => {
        reached.push('after-error');
      });

      await adapter.releaseDisposers(plugin.id);

      expect(reached).toEqual(['after-error']);
    });
  });

  describe('registerTools / unregisterTools（PY-0：SDK 工具注册进全局单例 ToolRegistry）', () => {
    const toolName = 'py0_test_greet';
    const plugin = createPlugin({
      id: 'py0-tools',
      name: 'Py0Tools',
      version: '1.0.0',
      description: '',
      author: 'demo',
      category: 'tool',
      tools: [
        {
          name: toolName,
          description: '向用户打招呼',
          parameters: {
            name: { type: 'string', description: '称呼', required: true },
          },
          execute: async (args: Record<string, unknown>) => ({
            success: true,
            data: { hello: args.name },
          }),
        },
      ],
    });

    test('SDK 插件声明 tools 后被注册进全局 ToolRegistry 且可调用', async () => {
      adapter.registerTools(plugin);

      const tool = getToolRegistry().getTool(toolName);
      expect(tool).toBeDefined();
      expect(tool!.name).toBe(toolName);
      expect(tool!.getInfo().description).toBe('向用户打招呼');
      expect(tool!.getInfo().params[0].required).toBe(true);

      const result = await tool!.execute({ name: 'world' }, {} as never);
      expect(result.data).toEqual({ hello: 'world' });

      adapter.unregisterTools(plugin);
      expect(getToolRegistry().getTool(toolName)).toBeUndefined();
    });

    test('插件返回 { success:false, error } 时工具结果为失败（显式失败契约）', async () => {
      const failingName = 'py0_test_fail';
      const failing = createPlugin({
        id: 'py0-fail',
        name: 'Py0Fail',
        version: '1.0.0',
        description: '',
        author: 'demo',
        category: 'tool',
        tools: [
          {
            name: failingName,
            description: '总是失败',
            execute: async () => ({ success: false, error: 'boom' }),
          },
        ],
      });

      adapter.registerTools(failing);
      const tool = getToolRegistry().getTool(failingName);
      expect(tool).toBeDefined();

      const result = await tool!.execute({}, {} as never);
      expect(result.success).toBe(false);
      expect(result.error).toBe('boom');

      adapter.unregisterTools(failing);
    });

    test('未声明 tools 时注册为空操作', () => {
      const plain = createPlugin({
        id: 'py0-no-tools',
        name: 'NoTools',
        version: '1.0.0',
        description: '',
        author: 'demo',
        category: 'tool',
      });
      expect(() => adapter.registerTools(plain)).not.toThrow();
    });

    test('撞名时 onConflict=error 抛出而非静默覆盖', () => {
      const other = createPlugin({
        id: 'py0-dup',
        name: 'Dup',
        version: '1.0.0',
        description: '',
        author: 'demo',
        category: 'tool',
        tools: [
          {
            name: toolName,
            description: '重复工具',
            execute: async () => ({ success: true }),
          },
        ],
      });

      adapter.registerTools(plugin);
      expect(() => adapter.registerTools(other)).toThrow(/already registered/i);
      adapter.unregisterTools(plugin);
    });
  });
});
