# Slack 渠道

## 概述

支持将 Liri 接入 Slack 工作空间，作为 Slack App 提供交互服务。

## 配置

```env
SLACK_ENABLED=true
SLACK_BOT_TOKEN=your_bot_token
SLACK_APP_TOKEN=your_app_token
SLACK_SIGNING_SECRET=your_signing_secret
```

## 功能

- 消息收发
- 斜杠命令
- 消息快捷方式
- 频道会话隔离
- 文件分享处理

## 设置步骤

1. 在 Slack API 创建 App
2. 启用 Socket Mode
3. 配置 Bot Token Scopes
4. 订阅事件
5. 安装到工作空间
6. 配置环境变量并启动

## 事件订阅

需要订阅以下事件：

- `message.channels`
- `message.groups`
- `message.im`
- `app_mention`
