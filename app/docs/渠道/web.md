# Web 渠道

## 概述

通过 Web 界面与 Liri 交互，提供 REST API 和 WebSocket 支持。

## 配置

```env
WEB_CHANNEL_ENABLED=true
PORT=3000
HOST=0.0.0.0
```

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| POST | `/api/chat` | 聊天接口 |
| GET | `/api/chat/stream` | 流式聊天 |
| GET | `/api/sessions` | 会话列表 |
| POST | `/api/tools` | 工具调用 |

## WebSocket

支持 WebSocket 连接，实现实时消息推送。

```
ws://localhost:3000/ws
```

## 认证

Web 渠道支持以下认证方式：

- API Key (Header: `X-API-Key`)
- Bearer Token (Header: `Authorization`)
- Session Cookie

## 请求示例

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{"message": "Hello, Liri!"}'
```
