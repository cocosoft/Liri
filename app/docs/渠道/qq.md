# QQ 渠道

## 概述

支持将 Liri 接入 QQ 机器人。

## 配置

```env
QQ_APP_ID=your_app_id
QQ_APP_SECRET=your_app_secret
# 可选：默认发送目标
# QQ_HOME_CHANNEL_ID=your_group_or_channel_id
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
