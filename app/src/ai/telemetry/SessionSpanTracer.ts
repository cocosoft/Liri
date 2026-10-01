/**
 * Session-level Span 属性 —— **转出层**（H5-④ 收口，台账 D-206）
 *
 * 实现已**下沉**至 **core 模块根** `core/SessionSpanTracer.ts`（该文件零项目依赖，层无关），
 * 本文件仅**原址转出**（对外导出名与签名逐字不变 ⇒ `ai/telemetry/index.ts` · `ai/index.ts`
 * 等既有消费方零改动）。
 *
 * 原因：`channels`(service) 的 `GatewaySessionTracer.ts` / `routing/messageRouter.ts`
 * 需要其类型/词汇表/tracer 工厂，而 service 不得依赖 app 层 ⇒ 定义归 core，app 层转出
 * （同 D-67 / D-157 / D-203 / D-204 手法）。
 *
 * @see ../../core/SessionSpanTracer.ts 规范定义
 */
export * from '../../core/SessionSpanTracer.js';
