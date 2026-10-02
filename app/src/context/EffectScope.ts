/**
 * EffectScope —— **转出层**（H5-⑤ 收口，台账 D-207）
 *
 * 实现已**改归 infra**（`utils/EffectScope.ts`）：原置 app 层 `context/`，导致
 * `channels`(service) 的 `ChannelBootstrapper.ts` 取用构成 `channels -> context` 倒挂。
 * 本文件仅**原址转出**（对外导出名与形状逐字不变 ⇒ `@modules/context` 既有消费方零改动）。
 *
 * ⚠️ 未下沉 core：本实现依赖 `@modules/error` + `@modules/monitoring`（infra），
 * 置 core 会新增 `core -> infra` 边（净零收益）⇒ 归 infra；service/app → infra 均为合法方向。
 *
 * @see ../utils/EffectScope.ts 规范定义
 */
export * from '../utils/EffectScope.js';
