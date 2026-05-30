# 微信渠道

## 概述

支持将 Liri 接入微信公众号或企业微信。

## 配置

```env
WECHAT_ENABLED=true
WECHAT_APP_ID=your_app_id
WECHAT_APP_SECRET=your_app_secret
WECHAT_TOKEN=your_token
WECHAT_ENCODING_AES_KEY=your_aes_key
```

## 功能

- 消息收发
- 菜单交互
- 模板消息
- 二维码登录

## 设置步骤

1. 在微信公众平台注册服务号
2. 启用开发者模式
3. 配置服务器地址（需公网可访问）
4. 验证 Token
5. 配置环境变量并启动

## 支持的账号类型

- 微信公众号（服务号）
- 企业微信
- 微信小程序
