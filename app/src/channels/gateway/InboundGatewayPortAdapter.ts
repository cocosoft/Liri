/**
 * 入站网关端口的**结构适配器**（通道治理 **阶段 2.4**，2026-10-12）。
 *
 * 作用：把 core 侧 `InboundEnvelopeDto` **形状搬运**到入站路由委托（**不新增能力**）。
 *
 * ⚠️ **UW（预留端口）**：**必须注入** `delegates.route` —— 真实入站路由依赖
 * `routeChannelMessage(RouteMessageOptions)` 的 `coreAPI` + 多回调，这些依赖在
 * `channels/setup/setupChannels.ts` 组装就绪 ⇒ **真实注册在 `setupChannels` 随消费者落地时完成**
 * （本期不注册，`resolveInboundGateway()` 保持未注册裁决）。这里不做默认委托，是**刻意**的：
 * 凭空构造一个没有 coreAPI 的路由等于伪造能力。
 */
import type {
  IInboundGatewayPort,
  InboundEnvelopeDto,
  InboundVerdictDto,
} from '@modules/core/spi';

/** 入站路由委托面（由 `setupChannels` 侧提供：持有 `coreAPI` + 回调） */
export interface InboundGatewayDelegates {
  route: (envelope: InboundEnvelopeDto) => Promise<InboundVerdictDto>;
}

/** 出站/入站端口实现：core DTO → 入站路由委托（纯形状搬运） */
export class InboundGatewayPortAdapter implements IInboundGatewayPort {
  private readonly delegates: InboundGatewayDelegates;

  constructor(delegates: InboundGatewayDelegates) {
    this.delegates = delegates;
  }

  route(envelope: InboundEnvelopeDto): Promise<InboundVerdictDto> {
    return this.delegates.route(envelope);
  }
}
