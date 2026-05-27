# 插件 API 参考

## PluginBase

所有插件的基类。

```typescript
class PluginBase {
  // 元数据
  meta: PluginMeta;

  // 工具
  logger: Logger;
  config: PluginConfig;
  storage: PluginStorage;
  events: EventBus;

  // 生命周期钩子
  onInstall(): Promise<void>;
  onInit(): Promise<void>;
  onEnable(): Promise<void>;
  onDisable(): Promise<void>;
  onUninstall(): Promise<void>;
}
```

## 工具注册

```typescript
plugin.registerTool(name: string, tool: Tool): void;
plugin.unregisterTool(name: string): void;
```

## 技能注册

```typescript
plugin.registerSkill(name: string, skill: Skill): void;
plugin.unregisterSkill(name: string): void;
```

## 事件系统

```typescript
plugin.events.on(event: string, handler: Function): void;
plugin.events.once(event: string, handler: Function): void;
plugin.events.off(event: string, handler: Function): void;
plugin.events.emit(event: string, data: unknown): void;
```

## 存储

```typescript
plugin.storage.get(key: string): Promise<unknown>;
plugin.storage.set(key: string, value: unknown): Promise<void>;
plugin.storage.delete(key: string): Promise<void>;
plugin.storage.clear(): Promise<void>;
```

## 配置

```typescript
plugin.config.get(key: string): unknown;
plugin.config.set(key: string, value: unknown): void;
plugin.config.getAll(): Record<string, unknown>;
```
