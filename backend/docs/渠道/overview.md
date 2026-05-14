# 渠道概述

## 架构

```
用户 → 消息渠道 → 渠道适配器 → 网关 → Agent → 响应
                     ↓
               消息队列/缓存
```

## 渠道生命周期

1. **连接**: 建立与消息服务的连接
2. **鉴权**: 验证渠道身份
3. **消息接收**: 监听并接收用户消息
4. **处理**: 转发消息到 Agent 处理
5. **响应**: 将 Agent 回复发送回渠道
6. **断开**: 优雅关闭连接

## 渠道配置

通用配置项：

| 配置 | 说明 | 默认值 |
|------|------|--------|
| `enabled` | 是否启用 | `true` |
| `token` | 渠道令牌 | - |
| `webhookUrl` | Webhook 地址 | - |
| `rateLimit` | 频率限制 | `60/min` |

## 消息格式

所有渠道的消息统一转换为内部格式：

```typescript
type Message = {
  id: string;
  channel: string;
  userId: string;
  content: string;
  attachments?: Attachment[];
  timestamp: number;
};
```
