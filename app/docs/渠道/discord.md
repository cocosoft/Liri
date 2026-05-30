# Discord 渠道

## 概述

支持将 Liri 接入 Discord 服务器，作为机器人提供交互服务。

## 配置

```env
DISCORD_ENABLED=true
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_client_id
DISCORD_GUILD_ID=your_guild_id
```

## 功能

- 消息收发
- 斜杠命令支持
- 消息提及响应
- 附件处理
- 多频道隔离

## 设置步骤

1. 在 Discord Developer Portal 创建应用
2. 添加 Bot 并获取 Token
3. 配置 Bot 权限（Send Messages, Read Messages, Mention）
4. 将 Bot 邀请到服务器
5. 配置环境变量并启动

## 权限

需要以下 Bot 权限：

- `Send Messages`
- `Read Message History`
- `Mention Everyone`
- `Attach Files`
- `Read Messages/View Channels`
