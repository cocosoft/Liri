# IRC 渠道

## 概述

支持将 Liri 接入 IRC 协议。

## 配置

```env
IRC_ENABLED=true
IRC_SERVER=irc.libera.chat
IRC_PORT=6697
IRC_NICKNAME=py-app-bot
IRC_CHANNELS=#py-app,#general
IRC_USE_TLS=true
IRC_PASSWORD=optional_password
```

## 功能

- 频道消息收发
- 私聊支持
- 命令响应
- 用户管理

## 设置步骤

1. 选择 IRC 服务器
2. 注册昵称
3. 加入频道
4. 配置环境变量并启动
