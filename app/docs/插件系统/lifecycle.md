# 插件生命周期

## 生命周期阶段

```
安装 → 初始化 → 启用 → 运行 → 禁用 → 卸载
```

## 钩子方法

```typescript
export class MyPlugin extends PluginBase {
  // 插件安装时调用
  async onInstall(): Promise<void> {
    // 创建必要的数据目录
    // 注册资源
  }

  // 插件初始化时调用
  async onInit(): Promise<void> {
    // 加载配置
    // 初始化连接
  }

  // 插件启用时调用
  async onEnable(): Promise<void> {
    // 注册工具和技能
    // 监听事件
    // 启动定时任务
  }

  // 插件禁用时调用
  async onDisable(): Promise<void> {
    // 注销工具和技能
    // 清理资源
  }

  // 插件卸载时调用
  async onUninstall(): Promise<void> {
    // 清理数据
    // 删除配置
  }
}
```

## 状态转换

| 状态 | 说明 |
|------|------|
| installed | 已安装，未初始化 |
| initialized | 已初始化，未启用 |
| enabled | 运行中 |
| disabled | 已禁用 |
| uninstalled | 已卸载 |
