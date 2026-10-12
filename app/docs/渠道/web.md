# Web / HTTP 接入

> ⚠️ **历史文档订正（2026-10-12）**：Liri **没有**名为 `web` 的消息通道 —— `channels/` 下无 `web/` 目录，
> `ChannelId` 与 `CHANNEL_CATALOG` 中亦无 `web` 项。本页原描述的 `WEB_CHANNEL_ENABLED`、`/api/chat`、
> `PORT=3000` 等**均不存在**。Web 交互的正确入口见下。

## 概述

Web 侧交互由两部分提供（**均非"通道"**）：

1. **Web 前端**：`client/`（Vite + React），经 HTTP/SSE 与后端通信；
2. **本地 HTTP 服务**：`infrastructure/http/LocalHTTPService`（流式见 `LocalHTTPServiceSSE`）。

如需"用消息平台与 Agent 交互"，请使用内置的 26 个**消息通道**（见 [渠道概述](overview.md)）。

## 地址与端口

- **默认端口 `18990`** —— `core/ports.ts:16` `DEFAULT_HTTP_PORT`（可用 `--http-port` 参数或
  `LIRI_HTTP_PORT` 环境变量覆盖；优先级：参数 > 环境变量 > 常量）。
- **端点前缀 `/v1/`**，例如：`POST /v1/chat/stream`（流式对话）、`GET /v1/tools`（工具清单）、
  `GET /v1/cost/daily-budget`（日预算）。

## 鉴权

本地 HTTP 服务默认采用**本机信任基线**（免认证取向），与**对外 A2A 面刻意区分**；
详见 `bridge/ModuleBridgeSetup.ts` 与 `infrastructure/http/` 相关实现。

## 相关

- [渠道目录](index.md) · [渠道概述](overview.md)
- [网关 / 消息接入](../核心模块/gateway.md)（通道注册 / 入站路由 / 出站投递的真实承载）
