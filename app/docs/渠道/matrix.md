# Matrix 渠道

## 概述

支持将 PY_APP 接入 Matrix 协议。

## 配置

```env
MATRIX_ENABLED=true
MATRIX_HOMESERVER=https://matrix.example.com
MATRIX_USERNAME=@py-app-bot:example.com
MATRIX_PASSWORD=your_password
MATRIX_DEVICE_ID=PY_APP_BOT
```

## 功能

- 房间消息收发
- 私聊支持
- 文件分享
- 消息编辑

## 设置步骤

1. 注册 Matrix 账号
2. 创建或加入房间
3. 配置环境变量并启动
