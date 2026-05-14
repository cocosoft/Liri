# 渠道路由

## 概述

渠道路由功能允许将消息分发到不同的渠道，支持条件路由和负载均衡。

## 配置

```json
{
  "routing": {
    "rules": [
      {
        "name": "技术问题到Discord",
        "condition": "message.match(/技术|bug|error/i)",
        "target": "discord"
      },
      {
        "name": "普通问题到Slack",
        "condition": "true",
        "target": "slack"
      }
    ],
    "default": "web"
  }
}
```

## 路由策略

| 策略 | 说明 |
|------|------|
| `round_robin` | 轮询分发 |
| `weighted` | 加权分发 |
| `priority` | 优先级分发 |
| `condition` | 条件路由 |

## 路由规则

```typescript
interface RoutingRule {
  name: string;
  condition: string;
  target: string | string[];
  priority?: number;
}
```

## 广播模式

```typescript
// 广播到所有渠道
channelRouter.broadcast(message, ["discord", "slack", "telegram"]);
```
