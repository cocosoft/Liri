# 网关 / 消息接入（Gateway）

> ⚠️ **历史文档订正（2026-10-12）**：本文原描述的 `core/gateway/`（`GatewayServer` / `ChannelManager` /
> `GatewayEventBus` / `GatewayAuth` / `HealthMonitor` / `RateLimiter` / `GatewayMcpBridge`）**在本仓已不存在**
> —— `core/gateway/` 目录于 2026-08-06 移除（依据见 `channels/registry/ChannelRegistry.ts` 头注）。
> 下方为**当前真实实现**。

## 概述

Liri 的"网关"能力现由 `src/channels/` 内的组件承载，**不再有独立的 `core/gateway/` 子系统**：

| 能力 | 真实实现 | 位置 |
|---|---|---|
| 通道注册 / 生命周期 | `ChannelRegistry`（单例 `channelRegistry`）+ `ChannelBootstrapper`（单例 `channelBootstrapper`） | `channels/registry/ChannelRegistry.ts` · `channels/bootstrap/ChannelBootstrapper.ts` |
| 入站统一路由 | `routeChannelMessage()`（**唯一入口**） | `channels/routing/messageRouter.ts` |
| 出站投递（降级 / 重连 / 串行锁） | `DeliveryRouter`（单例 `getDeliveryRouter()`） | `channels/DeliveryRouter.ts` |
| 通道事件总线 | `channelEventBus` + `ChannelEvents`（与 `globalEventBus` **选择性**桥接） | `channels/events/ChannelEventBus.ts` |
| 设备配对 | `DevicePairingService` | `channels/DevicePairingService.ts` |

## 入站管线（`routeChannelMessage`）

```
①帧验证 → ①-②DM 策略 → ②messageId 去重 → ②-②内容去重 → ②-③入站限流
→ ③共享会话写入 → ④会话创建/复用 → ⑤CoreAPI.chatStream → ⑥出站投递
```

阶段与常量见 `channels/routing/messageRouter.ts` 头注与 `channels/routing/messageRouterContract.ts`。

## 出站投递（`DeliveryRouter`）

- `deliverToOrigin(platform, conversationId, content)`：按来源通道回投；
- `broadcast(content)`：广播到所有已启用通道；
- **格式降级链** `interactive → markdown → text`（`channels/deliveryFormatters.ts`）；
- per-channel **串行锁**（`_withChannelLock`）、连接自愈（`_prepareChannel`）、逐格式降级（`_sendWithFallback`）。

## HTTP / SSE 面（**不属于** "网关"）

对外 HTTP 服务是 `infrastructure/http/LocalHTTPService`（流式见 `LocalHTTPServiceSSE`），
默认端口 `DEFAULT_HTTP_PORT = 18990`（`core/ports.ts:16`），端点前缀 `/v1/`。

## 相关

- 通道系统规范：`.trae/rules/project_rules.md §1.14`；
- 通道上限：`CHANNEL_MAX_COUNT`，默认 **10**；
- 已有 26 个内置通道：见 [渠道概述](../渠道/overview.md)。
