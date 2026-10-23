/**
 * 出站网关端口 SPI（core 层端口）—— 通道治理 **阶段 2.1「Port Layer Only」**（2026-10-12）。
 *
 * 规格：`dev_docs/20261012/通道治理方案-20261012.md §3 阶段 2`（方向已锁：**先端口化、26 通道仍进程内**；
 * 进程级侧车化推迟到遥测证明必要时再做）。
 *
 * ⚠️ **预留端口 / 生产中暂无消费者**：本期只把**既有** `channels/DeliveryRouter` 的能力
 * 暴露为一个 **core 侧窄契约**（形状搬运由 app/service 层适配器完成），为后续「四原语只读出站广播」
 * 与「进程外通道插件」预留接缝 ⇒ **勿视为新增能力**；已按 UW 处理（先例：`ICollaborationPort`）。
 *
 * **分层**：端口声明在 **core**（最内层，不静态依赖任何上层）；实现体在 **channels**
 * （`channels/gateway/OutboundGatewayPortAdapter`，service 层 → core 为**合法下行**），
 * 由组合根（`entrypoints/spiWiring.ts`）注入。
 *
 * **未注册时**：`resolveOutboundGateway()` 返回**空操作代理** —— 明确以**失败结果**作答
 * （`success:false` + `error:'outbound gateway not registered'`），**不伪造成功**（不造默认值，同既有 SPI 语义）。
 */

/** 投递格式（core 侧 DTO；与 `channels/deliveryFormatters` 的 `DELIVERY_FORMAT_CHAIN` 同形） */
export type GatewayFormat = 'text' | 'markdown' | 'interactive' | 'none';

/** 出站内容（core 侧 DTO，**最小必要**） */
export interface GatewayContentDto {
  readonly format: GatewayFormat;
  /** 纯文本正文（`interactive` 时为兜底文本的等价物） */
  readonly content: string;
  /** 交互卡片兜底文本（`format==='interactive'` 时使用） */
  readonly fallbackText?: string;
  /** 交互卡片载荷（**不透明**：core 不定义卡片 Schema，由实现侧解释） */
  readonly card?: unknown;
}

/** 单次投递结果（core 侧 DTO） */
export interface GatewayDeliveryResultDto {
  readonly success: boolean;
  readonly actualFormat: GatewayFormat;
  readonly error?: string;
  /** 实际经历的降级步骤（格式名，保序） */
  readonly fallbackSteps?: ReadonlyArray<string>;
}

/** 广播结果（core 侧 DTO） */
export interface GatewayBroadcastResultDto {
  readonly total: number;
  readonly success: number;
  readonly failed: number;
}

/**
 * 出站网关端口（core 侧契约）。
 *
 * 实现侧（`DeliveryRouter`）已具备降级链 / 串行锁 / 退避重连；**端口只声明契约**，
 * 具体语义（降级、重试、并发保护）由实现侧承担，端口不做承诺。
 */
export interface IOutboundGatewayPort {
  /** 回投到来源通道 */
  deliverToOrigin(
    platform: string,
    conversationId: string,
    content: GatewayContentDto
  ): Promise<GatewayDeliveryResultDto>;
  /** 广播到所有启用通道 */
  broadcast(content: GatewayContentDto): Promise<GatewayBroadcastResultDto>;
}

/** SPI 服务标识符常量 */
export const OUTBOUND_GATEWAY_SERVICE_ID = 'core.spi.IOutboundGatewayPort';

// ---------------------------------------------------------------------------
// 内部 SPI 服务引用：由 registerOutboundGatewaySpi 在启动时设置。
// ---------------------------------------------------------------------------

let _service: IOutboundGatewayPort | null = null;

/** 转发**代理**（延迟绑定；未注册 ⇒ 以**失败结果**作答，不伪造成功） */
const _proxy: IOutboundGatewayPort = {
  deliverToOrigin: (platform, conversationId, content) =>
    _service
      ? _service.deliverToOrigin(platform, conversationId, content)
      : Promise.resolve({
          success: false,
          actualFormat: 'none',
          error: 'outbound gateway not registered',
        }),
  broadcast: (content) =>
    _service
      ? _service.broadcast(content)
      : Promise.resolve({ total: 0, success: 0, failed: 0 }),
};

/** 获取出站网关端口（未注册时返回空操作代理） */
export function resolveOutboundGateway(): IOutboundGatewayPort {
  return _proxy;
}

/**
 * 注册出站网关 SPI 实现到 DI 容器（**推送模型**）。
 *
 * 实现体由 **entry** 侧装配模块（`entrypoints/spiWiring.ts`）构建后传入；
 * 此函数**不产生静态跨层依赖**。
 */
export async function registerOutboundGatewaySpi(
  container: {
    registerDescriptor: <T>(desc: {
      id: string;
      factory: () => T;
      scope: 'singleton' | 'transient' | 'request';
    }) => void;
  },
  service: IOutboundGatewayPort
): Promise<void> {
  _service = service;

  container.registerDescriptor<IOutboundGatewayPort>({
    id: OUTBOUND_GATEWAY_SERVICE_ID,
    factory: () => _service as IOutboundGatewayPort,
    scope: 'singleton',
  });
}
