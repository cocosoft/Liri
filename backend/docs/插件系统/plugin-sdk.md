# 插件 SDK

## 概述

插件 SDK 提供开发插件所需的核心工具和类型定义。

## 基础结构

```typescript
import { PluginBase } from "@py-app/plugin-sdk";

export default class MyPlugin extends PluginBase {
  // 插件元数据
  meta = {
    name: "my-plugin",
    version: "1.0.0",
    description: "我的插件"
  };

  // 初始化
  async onInit(): Promise<void> {
    console.log("插件初始化");
  }

  // 启用
  async onEnable(): Promise<void> {
    console.log("插件已启用");
  }

  // 禁用
  async onDisable(): Promise<void> {
    console.log("插件已禁用");
  }

  // 卸载
  async onUninstall(): Promise<void> {
    console.log("插件已卸载");
  }
}
```

## SDK 工具

### 日志

```typescript
this.logger.info("信息");
this.logger.warn("警告");
this.logger.error("错误");
```

### 配置

```typescript
// 读取插件配置
const config = this.config.get("apiKey");
```

### 存储

```typescript
// 插件私有存储
await this.storage.set("key", "value");
const value = await this.storage.get("key");
```

### 事件

```typescript
// 监听系统事件
this.events.on("message:received", handler);

// 触发自定义事件
this.events.emit("my-plugin:custom-event", data);
```

## 工具注册

```typescript
// 注册自定义工具
this.registerTool("my_tool", {
  description: "我的工具",
  execute: async (params) => {
    return `Hello, ${params.name}`;
  }
});
```

## 技能注册

```typescript
// 注册自定义技能
this.registerSkill("my_skill", {
  description: "我的技能",
  handler: async (input) => {
    return `处理: ${input}`;
  }
});
```
