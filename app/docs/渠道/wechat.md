# 微信渠道（个人微信）

## 概述

通过 weixin-cli HTTP Bridge 接入个人微信，支持扫码登录后收发消息。

## 前置

```bash
npx -y @tencent-weixin/openclaw-weixin-cli@latest install
```

## 配置

```env
WECHAT_BOT_HTTP_URL=http://localhost:7600
```

## 功能

- 私聊消息收发
- 图片发送

## 设置步骤

1. 运行安装命令: `npx -y @tencent-weixin/openclaw-weixin-cli@latest install`
2. 启动 weixin-cli 服务，扫描二维码登录
3. 确保 HTTP 服务在 `WECHAT_BOT_HTTP_URL` 地址可访问
4. 在 Liri 前端消息渠道中填写 Bot HTTP URL，保存并开启
