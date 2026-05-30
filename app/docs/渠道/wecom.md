# 企业微信渠道

## 概述

支持将 Liri 接入企业微信，作为企业微信自建应用提供交互服务。

## 配置

```env
WECOM_ENABLED=true
WECOM_CORP_ID=your_corp_id
WECOM_AGENT_ID=your_agent_id
WECOM_SECRET=your_secret
WECOM_TOKEN=your_token
WECOM_ENCODING_AES_KEY=your_aes_key
```

## 功能

- 消息收发
- 应用消息推送
- 菜单交互
- 企微通讯录同步

## 设置步骤

1. 登录企业微信管理后台
2. 创建自建应用
3. 获取 CorpID、AgentID 和 Secret
4. 配置企业可信 IP
5. 配置环境变量并启动
