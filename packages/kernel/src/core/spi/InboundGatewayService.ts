/**
 * 入站网关端口 SPI（core 层端口）—— 通道治理 **阶段 2.4**（2026-10-12）。
 *
 * ⚠️ **UW（预留端口 / 生产中暂无消费者）**：本期只确立**主内核与外部通道插件之间的唯一入站契约**
 * （先例 `ICollaborationPort` / `IOutboundGatewayPort`）。**注册点不在组合根**：入站路由依赖
 * `routeChannelMessage(RouteMessageOptions)` 的 `coreAPI` + 多回调，这些依赖在
 * `channels/setup/setupChannels.ts` 才组装就绪 ⇒ **真实注册随消费者（进程外通道插件 / 入站侧车）
 * 落地时在 `setupChannels` 完成**。在此之前 `resolveInboundGateway()` 一律返回**未注册裁决**
 * （`accepted:false` + `reason:'inbound gateway not registered'`，**不伪造接受**）。
 *
 * **分层**：端口声明在 core（不静态依赖上层）；实现体在 service 层
 * （`channels/gateway/InboundGatewayPortAdapter`，**形状搬运**）。
 */

/** 入站载荷类型（core 侧口径：文本 or 文件；语义细节留在 `attachments`） */
export type InboundPayloadKind = 'text' | 'file';

/** 标准化附件元数据（core 侧形状；与 `channels/routing/messageRouterContract` 同形） */
export interface InboundAttachmentDtoShape {
  type: string;
  url?: string;
  path?: string;
  name?: string;
  size?: number;
}

/** 标准化入站信封（core 侧形状） */
export interface InboundEnvelopeDto {
  sessionId?: string;
  messageId: string;
  platform: string;
  payload: {
    type: InboundPayloadKind;
    content: string;
    attachments?: InboundAttachmentDtoShape[];
  };
  sender: { platform: string; userId: string };
  receivedAt: number;
}

/** 入站裁决（core 侧形状） */
export interface InboundVerdictDto {
  accepted: boolean;
  reason?: string;
  /** 路由侧决定的会话 ID（若已确定） */
  sessionId?: string;
}

/** 入站网关端口（core 侧契约） */
export interface IInboundGatewayPort {
  /**
   * 把**标准化入站信封**送入主内核入站管线（去重 → 帧校验 → 路由）。
   *
   * 端口**不承诺**幂等与排序语义（由实现侧承担）；同 `messageId` 重复投递由实现侧去重。
   */
  route(envelope: InboundEnvelopeDto): Promise<InboundVerdictDto>;
}

/** SPI 服务标识符常量 */
export const INBOUND_GATEWAY_SERVICE_ID = 'core.spi.IInboundGatewayPort';

let _service: IInboundGatewayPort | null = null;

/** 转发代理（未注册 ⇒ **未注册裁决**，不伪造接受） */
const _proxy: IInboundGatewayPort = {
  route: () =>
    Promise.resolve({
      accepted: false,
      reason: 'inbound gateway not registered',
    }),
};

/** 获取入站网关端口（未注册时返回空操作代理） */
export function resolveInboundGateway(): IInboundGatewayPort {
  return _proxy;
}

/** 注册入站网关 SPI 实现（**推送模型**；实现体由组合根/`setupChannels` 构建后传入） */
export async function registerInboundGatewaySpi(
  container: {
    registerDescriptor: <T>(desc: {
      id: string;
      factory: () => T;
      scope: 'singleton' | 'transient' | 'request';
    }) => void;
  },
  service: IInboundGatewayPort
): Promise<void> {
  _service = service;

  container.registerDescriptor<IInboundGatewayPort>({
    id: INBOUND_GATEWAY_SERVICE_ID,
    factory: () => _service as IInboundGatewayPort,
    scope: 'singleton',
  });
}
