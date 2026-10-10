// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * AI 能力访问 SPI（core 层端口）—— 2026-09-30 台账 D-124（`R00-003` P5 / G2）
 *
 * **问题**：**infra** 层的后台任务需使用 AI 能力 —— `chronos`（知识雨编译 / 知识库维护 /
 * 供应商余额刷新）与 `memory`（候选记忆 LLM 精选）直接动态导入 `ai` 层
 * ⇒ 构成 `infra -> app` 倒挂（`R00-003` 盲区，共 4 处）。
 *
 * **规则 43 双向取证（否决了"改归"路线）**：
 * - `chronos` 改归 app ⇒ 入向含 **infra** 的 `daemon/CronBridge`、`monitoring/archival` 与
 *   **service** 的 `services/BridgeChronosIntegration` ⇒ 反增 **3 处**违规；
 *   （⚠️ T-③05，2026-10-03：`daemon/CronBridge` 已随死链下线 ⇒ 该条入向现为 2 处；
 *   结论 **不受影响**——"chronos 确为 infra、只能走端口"仍成立）
 * - `memory` 改归 app ⇒ 入向含 `voice`/`constants`/`security` /`session`/`services` 等 ⇒ 更多。
 * ⇒ 二者**确为 infra**（被 infra/service 广泛消费），只能走端口。
 *
 * **方案**：与既有 6 个 SPI **同构** —— core 定义端口与**转发代理**；实现在
 * `registerAiAccessSpi()`（组合根缝）内**动态导入** `ai` 后注入 ⇒ chronos / memory 只依赖
 * `core/spi`（infra → core 合法）。**一次覆盖 4 处只需 1 个 `core -> ai` 对**（若按能力拆多个
 * SPI 文件，每文件各计 1 对 ⇒ 更差，故合并为单文件）。
 *
 * **未注册时**：`getAiService()` 返回 `null`、其余返回 `null` / 空数组 —— 消费方均已具备
 * 降级路径（编译跳过 / 余额跳过 / 记忆精选降级 top-K）。
 */

import type { BillingMode, TimeBasedPrice } from '../pricing.js';
// P1-7：装配顺序守卫（`knowledge` 依赖本端口，见 wiringGuard.ts 的 SPI_WIRING_REQUIRES）
import { markSpiRegistered } from './wiringGuard';

/** 供应商最小投影（`chronos` 余额刷新所需字段） */
export interface AiProviderBriefDto {
  id: string;
  name: string;
  baseUrl: string;
  /** 供应商可能未配置 key（与 app 侧 `apiKey` 可空一致） */
  apiKey?: string | undefined;
}

/** 余额探测结果（已落库；调用方仅需 `remaining` 做阈值日志） */
export interface BalanceProbeResultDto {
  remaining: number | null;
  total: number | null;
  used: number | null;
  unit: string;
}

/** 按角色调用结果（`raw` 供调用方原样透传给 `trackUsage` 等既有入口） */
export interface AiRoleChatResultDto {
  content: string;
  model: string;
  providerId: string;
  raw: unknown;
}

/**
 * 模型定价 + 规范名的**最小投影** —— `cost`(infra) 层 `ModelPricing.ts` / `PricingManager.ts`
 * 对 `ai/models`（`ModelRegistry.getModelPricing()` / `getModel()` / `getModelConfigById()`）
 * 的全部数据需求收敛为此结构（2026-10-01 D-155）。
 */
export interface AiModelPricingDto {
  /** 每百万 token 输入价（DB 唯一来源） */
  inputPer1M: number;
  /** 每百万 token 输出价 */
  outputPer1M: number;
  /** 计费模式（与 app 侧 `BillingMode` 同值区间） */
  billingMode: BillingMode;
  /** 按次计价单价（美元/请求） */
  pricePerRequest: number;
  /** 分时价格（`core/pricing.ts` 类型，命中时段覆盖默认价） */
  timeBasedPricing: TimeBasedPrice[];
  /** 缓存读价（原 `ModelRegistry.getModel().pricing.cacheReadPer1M`；缺省 0） */
  cacheReadPer1M: number;
  /** 缓存写价（原 `ModelRegistry.getModel().pricing.cacheWritePer1M`；缺省 0） */
  cacheWritePer1M: number;
  /** 规范模型名（原 `getModelConfigById(id).firstParty`；无匹配时回退入参模型名） */
  canonicalName: string;
}

/** AI 能力访问端口（core 侧契约） */
export interface IAiAccessService {
  /**
   * 知识编译所需 AI 服务（app 侧 `AIService`）。
   * ⚠️ 类型为 `unknown`（端口不引 app 类型）⇒ 调用方在**边界处**收窄。
   */
  getAiService(): unknown;
  /** 活跃供应商列表（已按 `isActive` 过滤） */
  listActiveProviders(): Promise<AiProviderBriefDto[]>;
  /**
   * 查询单个供应商余额并落库；`belowThreshold` 由参数 `threshold` 判定（阈值属调用方语义）。
   * 返回 `null` 表示查询失败或余额不可用。
   */
  refreshProviderBalance(
    providerId: string,
    baseUrl: string,
    apiKey: string,
    threshold: number
  ): Promise<BalanceProbeResultDto | null>;
  /**
   * 按任务角色解析模型 + 匹配 provider 并调用 `chat`（模型解析走 DB 唯一事实来源）。
   * 返回 `null` 表示无可用 provider 或调用失败。
   */
  chatWithRole(
    role: string,
    messages: unknown,
    options: unknown
  ): Promise<AiRoleChatResultDto | null>;

  // ── 2026-10-01 D-146（`infra -> app` 收口批次 1）：补齐 memory / chronos 所需能力 ──
  /** 上报一次用量（原 `@modules/ai` 的 `trackUsage`；`raw` 为 `chatWithRole` 返回的 `raw`） */
  trackUsage(raw: unknown, meta: Record<string, unknown>): void;
  /** 全局 embedding 管理器（原 `globalEmbeddingManager`：`getProvider()` / `embedOne()`） */
  getEmbeddingManager(): unknown;
  /** 模型路由器（原 `modelRouter`：`resolveAsync(role)`） */
  getModelRouter(): unknown;
  /** 供应商注册表（原 `providerRegistry`：`getByModel()` / `getDefaultProvider()`） */
  getProviderRegistry(): unknown;
  /** 构造 ToolAware 客户端（原 `new ToolAwareClient(provider, null, null)`） */
  createToolAwareClient(provider: unknown): unknown;
  /** 凭证存储（原 `credentialStore`；`CRED_STORED_MARKER` 由消费方自带） */
  getCredentialStore(): unknown;

  // ── 2026-10-01 D-155（`cost -> ai` 倒挂收口）：cost 层所需模型定价投影 ──
  /**
   * 查询模型的定价 + 规范名（原 `ModelRegistry.getModelPricing()` / `getModel()` /
   * `getModelConfigById()`，数据仍以 DB 为唯一事实来源）。
   * 返回 `null` 表示注册表中**查无此模型**（既无定价记录也无模型定义）。
   */
  getModelPricing(modelName: string): AiModelPricingDto | null;
}

/** SPI 服务标识符常量 */
export const AI_ACCESS_SERVICE_ID = 'core.spi.IAiAccessService';

// ---------------------------------------------------------------------------
// 内部 SPI 服务引用：由 registerAiAccessSpi 在启动时设置。
// infra 层（chronos / memory）通过 resolveAiAccess() 获取，避免直接 import app 层。
// ---------------------------------------------------------------------------

let _service: IAiAccessService | null = null;

/** 转发**代理**（延迟绑定，同 `resolveLogger()` 语义；注册前返回空值，消费方自行降级） */
const _proxy: IAiAccessService = {
  getAiService: () => _service?.getAiService() ?? null,
  listActiveProviders: () =>
    _service?.listActiveProviders() ?? Promise.resolve([]),
  refreshProviderBalance: (providerId, baseUrl, apiKey, threshold) =>
    _service?.refreshProviderBalance(providerId, baseUrl, apiKey, threshold) ??
    Promise.resolve(null),
  chatWithRole: (role, messages, options) =>
    _service?.chatWithRole(role, messages, options) ?? Promise.resolve(null),
  // D-146：新增能力的空值语义（消费方均已有降级路径 —— 跳过上报 / 无 embedding / 无 provider）
  trackUsage: (raw, meta) => _service?.trackUsage(raw, meta),
  getEmbeddingManager: () => _service?.getEmbeddingManager() ?? null,
  getModelRouter: () => _service?.getModelRouter() ?? null,
  getProviderRegistry: () => _service?.getProviderRegistry() ?? null,
  createToolAwareClient: (provider) =>
    _service?.createToolAwareClient(provider) ?? null,
  getCredentialStore: () => _service?.getCredentialStore() ?? null,
  // D-155：空值语义 —— 未注册时返回 null（cost 侧回退默认定价，与原行为一致）
  getModelPricing: (modelName) => _service?.getModelPricing(modelName) ?? null,
};

/** 获取 AI 能力访问端口（未注册时为空值） */
export function resolveAiAccess(): IAiAccessService {
  return _proxy;
}

/**
 * 注册 AI 能力访问 SPI 实现到 DI 容器（**推送模型**）
 *
 * 2026-09-30（台账 D-128，`R00-003` ② 改造）：实现体**由调用方（entry 装配模块）构建后传入** ——
 * 原实现在本文件内动态导入 `ai` ⇒ 产生 `core -> ai` 跨层对；改为推送后**该对消失**。
 *
 * @param container - DI 容器实例
 * @param service - 已构建的端口实现（`entrypoints/spiWiring.ts`）
 */
export async function registerAiAccessSpi(
  container: {
    registerDescriptor: <T>(desc: {
      id: string;
      factory: () => T;
      scope: 'singleton' | 'transient' | 'request';
    }) => void;
  },
  service: IAiAccessService
): Promise<void> {
  _service = service;
  // P1-7：标记已装配（供依赖端口在注册期断言顺序；见 core/spi/wiringGuard.ts）
  markSpiRegistered('aiAccess');

  container.registerDescriptor<IAiAccessService>({
    id: AI_ACCESS_SERVICE_ID,
    factory: () => service,
    scope: 'singleton',
  });
}
