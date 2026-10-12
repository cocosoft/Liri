/**
 * 出站网关端口的**结构适配器**（通道治理 **阶段 2.1「Port Layer Only」**，2026-10-12）。
 *
 * 作用：把 **core 侧** DTO（`GatewayContentDto` 等）**形状搬运**到**既有** `channels/DeliveryRouter`
 * —— **不新增任何能力**（降级链 / 串行锁 / 退避重连仍由 `DeliveryRouter` 承担）。
 *
 * ⚠️ **预留端口 / 生产中暂无消费者**：本期只提供接缝（对齐 `ICollaborationPort` 的 UW 处理）。
 * 分层：本文件在 **service（channels）** 层 → 依赖 **core** 为**合法下行**。
 */
import type {
  IOutboundGatewayPort,
  GatewayContentDto,
  GatewayDeliveryResultDto,
  GatewayBroadcastResultDto,
} from '@modules/core/spi';
import { getDeliveryRouter } from '../DeliveryRouter.js';

/** 可注入的委托面（**测试专用**：不构造真实 router ⇒ 单测离线、确定） */
export interface OutboundGatewayDelegates {
  deliverToOrigin: (
    platform: string,
    conversationId: string,
    content: GatewayContentDto
  ) => Promise<GatewayDeliveryResultDto>;
  broadcast: (content: GatewayContentDto) => Promise<GatewayBroadcastResultDto>;
}

/**
 * 出站网关端口实现：把 core DTO 转发给 `DeliveryRouter`。
 *
 * - 默认委托：**延迟取** `getDeliveryRouter()`（构造期不触发 router 构建/注册副作用）；
 * - 可注入 `delegates` 覆盖（测试）。
 */
export class OutboundGatewayPortAdapter implements IOutboundGatewayPort {
  private readonly delegates: OutboundGatewayDelegates;

  constructor(delegates?: Partial<OutboundGatewayDelegates>) {
    this.delegates = {
      deliverToOrigin:
        delegates?.deliverToOrigin ??
        ((platform, conversationId, content) =>
          getDeliveryRouter().deliverToOrigin(
            platform as never,
            conversationId,
            content as never
          ) as unknown as Promise<GatewayDeliveryResultDto>),
      broadcast:
        delegates?.broadcast ??
        ((content) =>
          getDeliveryRouter().broadcast(
            content as never
          ) as unknown as Promise<GatewayBroadcastResultDto>),
    };
  }

  deliverToOrigin(
    platform: string,
    conversationId: string,
    content: GatewayContentDto
  ): Promise<GatewayDeliveryResultDto> {
    return this.delegates.deliverToOrigin(platform, conversationId, content);
  }

  broadcast(content: GatewayContentDto): Promise<GatewayBroadcastResultDto> {
    return this.delegates.broadcast(content);
  }
}
