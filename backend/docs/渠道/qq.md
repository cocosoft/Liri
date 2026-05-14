# QQ 渠道

## 概述

支持将 PY_APP 接入 QQ 机器人。

## 配置

```env
QQ_ENABLED=true
QQ_APP_ID=your_app_id
QQ_BOT_TOKEN=your_bot_token
QQ_BOT_SECRET=your_bot_secret
```

## 功能

- 私聊消息
- 群聊消息
- 频道消息
- 图片和文件处理

## 设置步骤

1. 前往 QQ 开放平台注册机器人
2. 获取 AppID 和 Token
3. 配置 WebSocket 连接
4. 配置环境变量并启动

## 事件

- `GROUP_AT_MESSAGE_CREATE`: 群聊@消息
- `C2C_MESSAGE_CREATE`: 私聊消息
- `DIRECT_MESSAGE_CREATE`: 频道私信
