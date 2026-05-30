# Signal 渠道

## 概述

支持将 Liri 接入 Signal 消息服务。

## 配置

```env
SIGNAL_ENABLED=true
SIGNAL_PHONE_NUMBER=your_phone_number
SIGNAL_SERVER_URL=https://signal.example.com
SIGNAL_ACCOUNT_PASSWORD=your_account_password
```

## 功能

- 消息收发
- 端到端加密
- 群聊支持
- 附件处理

## 设置步骤

1. 准备 Signal 服务端环境（Signal CLI 或 Signal Messenger API）
2. 注册账号并验证手机号
3. 配置环境变量并启动

## 注意事项

- Signal 渠道需要 Signal Server 或 Signal CLI 作为后端
- 首次使用需要扫码关联设备
