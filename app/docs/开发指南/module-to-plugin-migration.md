# 模块到插件迁移指南

## 概述

将现有模块迁移为标准插件，使其享受热加载、依赖管理、版本控制和独立测试等能力。

## 迁移步骤

### 1. 创建插件包装器

在 `src/plugins/bundled/` 下创建 `<Module>Plugin.ts`：

```typescript
import type { Plugin, PluginContext } from '../../plugin-sdk';
import type { IPluginAPI } from '../api/PluginAPI';

export class MyModulePlugin implements Plugin {
  id = '@pyapp/plugin-my-module';
  name = 'My Module Plugin';
  version = '1.0.0';
  description = '插件化后的模块';

  private _api: IPluginAPI | null = null;

  setAPI(api: IPluginAPI): void {
    this._api = api;
  }

  getAPI(): IPluginAPI | null {
    return this._api;
  }

  async initialize(ctx: PluginContext): Promise<void> {
    // 通过 ctx.api 或 this._api 访问内核服务
  }

  async activate(): Promise<void> {
    // 注册命令、工具、事件监听器
  }

  async deactivate(): Promise<void> {
    // 清理资源、注销监听器
  }

  async dispose(): Promise<void> {
    this._api = null;
  }
}
```

### 2. 实现 Plugin 接口

| 方法 | 说明 | 必须实现 |
|------|------|---------|
| `initialize(ctx)` | 初始化，获取 API 引用 | 是 |
| `activate()` | 激活，注册资源 | 是 |
| `deactivate()` | 停用，清理资源 | 是 |
| `dispose()` | 销毁，释放内存 | 否 |

### 3. 替换直接导入为 PluginAPI 调用

迁移前：

```typescript
import { someService } from '@modules/some-module';
const result = await someService.doSomething();
```

迁移后：

```typescript
const result = await this._api.services.resolve('kernel.someService').doSomething();
```

### 4. 注册到 PluginRegistry

在 `BundledPluginManager.ts` 中添加注册：

```typescript
this.plugins.set('my-module', {
  name: 'my-module',
  description: '我的模块插件',
  entryPoint: 'bundled/MyModulePlugin.js',
  enabled: true,
  builtin: true,
});
```

### 5. 编写契约测试

```typescript
import { describe, it, expect } from 'bun:test';
import { MyModulePlugin } from './MyModulePlugin';
import { createPluginAPI } from '../api/PluginAPI';

describe('MyModulePlugin — 插件契约', () => {
  it('应具有正确的元数据', () => {
    const plugin = new MyModulePlugin();
    expect(plugin.id).toBe('@pyapp/plugin-my-module');
    expect(plugin.version).toBeDefined();
  });

  it('应支持完整的生命周期', async () => {
    const plugin = new MyModulePlugin();
    const api = createPluginAPI('test');
    plugin.setAPI(api);
    await plugin.initialize({ api } as any);
    await plugin.activate();
    await plugin.deactivate();
    await plugin.dispose();
  });
});
```

### 6. 验证向后兼容性

- 保留原有模块的直接导入路径（`@modules/my-module`）
- 新增插件路径（`@modules/plugins/bundled/MyModulePlugin`）
- 确保所有已有测试通过

## PluginAPI 参考

| 域 | 方法 | 说明 |
|------|--------|------|
| `commands` | `registerCommand(name, fn)` | 注册命令 |
| `commands` | `executeCommand(name, args)` | 执行命令 |
| `commands` | `getRegisteredCommands()` | 列出命令 |
| `tools` | `registerTool(name, tool)` | 注册工具 |
| `tools` | `getTool(name)` | 获取工具 |
| `tools` | `getRegisteredTools()` | 列出工具 |
| `settings` | `get(key, default?)` | 读取设置 |
| `settings` | `set(key, value)` | 写入设置 |
| `settings` | `watch(key, cb)` | 监听设置变更 |
| `events` | `on(event, handler)` | 订阅事件 |
| `events` | `emit(event, data)` | 触发事件 |
| `events` | `off(event, handler)` | 取消订阅 |
| `resources` | `read(path)` | 读取资源文件 |
| `services` | `resolve(serviceId)` | 访问内核服务 |
| `services` | `hasService(serviceId)` | 检查服务可用性 |
| `session` | `createSession()` | 创建会话 |
| `session` | `sendMessage(msg)` | 发送消息 |

## 热加载

插件化后自动获得热加载能力：

```typescript
await pluginSystem.hotloadPlugin('my-module');   // 热加载
await pluginSystem.reloadPlugin('my-module');     // 重载（含依赖）
await pluginSystem.unloadPlugin('my-module');     // 卸载
```

## 参考示例

完整的迁移示例请参考 `src/plugins/bundled/BuddyPlugin.ts`（阶段2试点）。
