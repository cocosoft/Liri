/**
 * analytics 的**模型定价来源端口**（B8，2026-11-01）
 *
 * 背景：`analytics/CostAnalyticsTracker` 直接 `import { getModelPricing } from '../cost/ModelPricing'`，
 * 而 `cost` 又反向依赖 `analytics`（桶里再导出 analytics 的事件队列/追踪器）⇒ 二者同处 R7 的
 * infra 内环（analytics / cost / monitoring / performance 四元 SCC）。该内环此前因 `utils` 内部
 * 用相对导入而不可见，B8 让相对边可见后才暴露。
 *
 * 解环口径（同 `setAPISceneEnvReader` / `setDaemonMetricsSink` 等先例）：analytics 只保留端口，
 * 实现在 app 启动期注入（`wireAnalyticsDeps`）。**未注入**时退回内核的默认定价常量 —— 与旧
 * `getModelPricing` 的"无配置 ⇒ 默认值"语义一致，不静默产出错误报价。
 */
import {
  DEFAULT_MODEL_PRICING,
  type ModelPricing,
} from '@openliri/kernel/pricing';

/** 模型 → 定价（由 cost 模块提供） */
export type ModelPricingResolver = (model: string) => ModelPricing;

let resolver: ModelPricingResolver | null = null;

/** 注入/撤销定价来源（app 启动期调用；`null` = 撤销，测试用） */
export function setAnalyticsPricingResolver(
  fn: ModelPricingResolver | null
): void {
  resolver = fn;
}

/** 取该模型的定价（未注入 ⇒ 内核默认定价） */
export function resolveModelPricing(model: string): ModelPricing {
  return resolver ? resolver(model) : DEFAULT_MODEL_PRICING;
}
