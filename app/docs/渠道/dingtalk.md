# 钉钉渠道

## 概述

支持将 Liri 接入钉钉，作为钉钉机器人提供交互服务。

## 配置

```env
DINGTALK_ENABLED=true
DINGTALK_APP_KEY=your_app_key
DINGTALK_APP_SECRET=your_app_secret
DINGTALK_BOT_CODE=your_bot_code
```

## 功能

- 消息收发
- 群聊与单聊支持
- 机器人回调
- 免登录授权

## 设置步骤

1. 在钉钉开放平台创建应用
2. 获取 AppKey 和 AppSecret
3. 配置机器人回调 URL
4. 发布应用并配置环境变量
