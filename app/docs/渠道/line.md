# Line 渠道

## 概述

支持将 Liri 接入 Line 平台。

## 配置

```env
LINE_ENABLED=true
LINE_CHANNEL_ACCESS_TOKEN=your_channel_access_token
LINE_CHANNEL_SECRET=your_channel_secret
```

## 功能

- 消息收发
- 回复消息
- 推送消息
- 媒体文件

## 设置步骤

1. 在 Line Developer Console 创建 Provider 和 Channel
2. 获取 Channel Access Token
3. 配置 Webhook URL
4. 启用 Bot 功能

## 消息类型

- TextMessage
- ImageMessage
- VideoMessage
- AudioMessage
- LocationMessage
- StickerMessage
