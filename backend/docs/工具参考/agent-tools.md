# Agent 工具

## 描述

Agent 工具允许 Agent 创建子 Agent 并与之通信，实现任务的并行处理和分布式执行。

## 输入参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `config` | object | 是 | 子 Agent 配置 |
| `message` | string | 是 | 要发送的消息 |

## 使用示例

```javascript
// 创建子 Agent
Agent({
  config: {
    model: "gpt-4",
    tools: ["file_read", "web_search"]
  },
  message: "请搜索最新的 AI 技术发展"
})
```

## 功能

- 创建独立运行的子 Agent
- 子 Agent 拥有独立的工具集
- 支持结果收集和合并
- 任务超时和错误处理

## 使用场景

- 并行信息检索
- 分治处理复杂任务
- 隔离执行高风险操作
