# 流式处理

## 概述

流式处理支持 AI 模型生成内容的实时输出，用户在收到完整回复前即可看到部分内容。

## 工作原理

```
Agent 请求 → AI 模型 → Token 流 → 处理 → 显示
                ↓
           逐 Token 输出
```

## 使用方式

### CLI 模式

在 REPL 模式下，流式输出自动启用：

```bash
# 流式输出效果
$ 请写一首诗
正在生成...
床前明月光，
疑是地上霜。
举头望明月，   ← 逐步显示
低头思故乡。
```

### API 模式

```typescript
// 通过 API 使用流式输出
const stream = await agent.chatStream("写一首诗");

for await (const chunk of stream) {
  process.stdout.write(chunk.content);
}
```

## 流式事件

| 事件 | 说明 |
|------|------|
| `stream:start` | 流开始 |
| `stream:chunk` | 数据块到达 |
| `stream:end` | 流结束 |
| `stream:error` | 流错误 |

## 配置

```env
# 启用/禁用流式输出
STREAM_OUTPUT=true

# 流式缓冲区大小
STREAM_BUFFER_SIZE=1024
```

## 注意事项

- 流式输出需要 AI 模型支持
- 网络延迟会影响流式体验
- 流式输出不适用于所有场景（如工具调用）
