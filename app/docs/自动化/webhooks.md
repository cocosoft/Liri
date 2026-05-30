# Webhook

## 概述

Webhook 功能允许 Liri 接收外部系统的 HTTP 回调，并触发相应的处理流程。

## 配置

```bash
# 注册 Webhook
/webhook add my-webhook https://example.com/webhook

# 列出所有 Webhook
/webhook list

# 删除 Webhook
/webhook remove my-webhook

# 测试 Webhook
/webhook test my-webhook
```

## 请求格式

```json
POST /api/webhooks/my-webhook
Content-Type: application/json

{
  "event": "push",
  "repository": "my-repo",
  "commits": [...],
  "sender": "user"
}
```

## 签名验证

Liri 支持 Webhook 签名验证：

```env
WEBHOOK_SECRET=your_webhook_secret
```

## 支持的事件源

- GitHub (push, pull_request, issues)
- GitLab (push, merge_request)
- Jenkins (build complete)
- 自定义 HTTP 回调
