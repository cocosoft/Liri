# 钩子系统

## 概述

钩子系统允许插件在系统流程中注入自定义逻辑。

## 可用钩子

| 钩子 | 触发时机 |
|------|----------|
| `onMessage` | 收到消息时 |
| `onToolExecute` | 工具执行前 |
| `onToolResult` | 工具返回结果后 |
| `onAgentResponse` | Agent 生成回复后 |
| `onSessionCreate` | 会话创建时 |
| `onError` | 发生错误时 |

## 注册钩子

```json
{
  "hooks": {
    "onMessage": true,
    "onToolExecute": true
  }
}
```

## 实现钩子

```typescript
export class MyPlugin extends PluginBase {
  async onMessage(message: Message): Promise<Message | null> {
    // 修改或过滤消息
    if (message.content.includes("敏感词")) {
      return null; // 阻止消息
    }
    return message;
  }

  async onToolExecute(toolCall: ToolCall): Promise<ToolCall> {
    // 修改工具调用参数
    return toolCall;
  }
}
```

## 钩子优先级

钩子按优先级顺序执行，优先级高的先执行。插件可以在 manifest 中设置优先级：

```json
{
  "hooks": {
    "onMessage": {
      "enabled": true,
      "priority": 10
    }
  }
}
```
