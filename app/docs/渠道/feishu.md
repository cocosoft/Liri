# 飞书渠道

## 概述

支持将 PY_APP 接入飞书，作为飞书机器人提供交互服务。

## 配置

```env
FEISHU_ENABLED=true
FEISHU_APP_ID=your_app_id
FEISHU_APP_SECRET=your_app_secret
FEISHU_ENCRYPT_KEY=your_encrypt_key
FEISHU_VERIFICATION_TOKEN=your_verification_token
```

## 功能

- 消息收发
- 群聊与私聊支持
- 卡片消息
- 事件订阅

## 设置步骤

1. 在飞书开放平台创建应用
2. 获取 App ID 和 App Secret
3. 配置事件订阅（需要公网可访问的 Webhook 地址）
4. 启用机器人能力
5. 配置环境变量并启动
