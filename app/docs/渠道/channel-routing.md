# 渠道路由（出站投递）

> ⚠️ **历史文档订正（2026-10-12）**：本文原描述的**条件路由 / 负载均衡（`round_robin` / `weighted` /
> `priority`）以及 `channelRouter.broadcast(...)` 在当前代码中不存在** —— 全仓无 `channelRouter` 实现，
> 旧版配置示例里的 `routing.rules` 亦**无消费者**。下方为**当前真实**能力。

## 概述

本仓的"路由"分两侧：

- **入站**：统一走 `channels/routing/messageRouter.ts` 的 `routeChannelMessage()`（唯一入口，见
  [网关 / 消息接入](../核心模块/gateway.md)）；
- **出站**：统一走 `channels/DeliveryRouter.ts` 的 `DeliveryRouter`（单例 `getDeliveryRouter()`）。

## 真实能力（`DeliveryRouter`）

| 能力 | 方法 / 机制 | 位置 |
|---|---|---|
| 回投到来源通道 | `deliverToOrigin(platform, conversationId, content)` | `DeliveryRouter.ts:100` |
| 广播到所有启用通道 | `broadcast(content)`（逐通道经串行锁投递） | `DeliveryRouter.ts:240` |
| 格式降级 | `interactive → markdown → text`（``DELIVERY_FORMAT_CHAIN``） | `channels/deliveryFormatters.ts` · `DeliveryRouter.ts:398` |
| 并发保护 | per-channel **串行锁** | `DeliveryRouter.ts:379` |
| 连接自愈 | 重连准备（`_prepareChannel`） | `DeliveryRouter.ts:357` |

## 未实现（**勿按本文旧版实现**）

- ❌ **条件路由**（按消息内容选择目标通道）；
- ❌ **负载均衡策略**（`round_robin` / `weighted` / `priority`）；
- ❌ `channelRouter` 实例与 `routing.rules` 配置。

若要引入上述任一能力，须**先立项**，并评估与 `DeliveryRouter` / `ChannelRegistry.broadcast` 的关系
（避免出现第二套路由；对齐 CS01 与 `project_rules.md §1.14`）。

## 相关

- [渠道概述](overview.md) · [渠道目录](index.md)
- [网关 / 消息接入](../核心模块/gateway.md)
