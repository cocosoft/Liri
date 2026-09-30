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

import type http from 'http';

/**
 * AI 运维 —— **服务层端口**（C1「口径 C」：`ai` 域 **P1**；2026-09-30 台账 D-106）
 *
 * **范围（P1 = 4 文件 / 4 处）**：`LocalHTTPServiceHelpers.ts`（`aiService` 句柄 +
 * `getDefaultModel`）· `knowledge-handlers.ts`（`aiService` 句柄 —— **P3 遗留单点**）·
 * `semantic-index-handlers.ts`（全局嵌入管理器）· `research-handlers.ts`（**工厂** `createAIService`
 * + 角色模型路由）。
 * P2（`analytics-handlers` + `cost-handlers`）· P3（`agent-role-handlers` + `auth-access-routes` +
 * `translation-handlers`）· P4（`llama-handlers`）见 spec §3.13。
 * **四阶段共用同一端口**（规则 19：同域分阶段共用同一入口 `getAiOpsPort()`，不新增入口）。
 *
 * ⚠️ 端口**禁止引用 app 类型**（`R00-001` 连类型导入也计）：
 * - 返回 app 对象处用 `unknown`；仅**调用方实际读字段**者给**最小投影 DTO**；
 * - 参数**照原调用点实参**定（规则 12）。
 *
 * ⚠️ **两种形态并存**（判据 = 原调用点怎么写）：
 * - **不透明句柄**（`getAiServiceHandle`）：原调用点把 `aiService` **原样透传**给其他能力的端口
 *   （知识库编译）⇒ 端口必须回**真对象**（`unknown`），**不得**包装成结构替身；
 * - **工厂**（`createAiService`）：`research-handlers` 调 `createAIService({...})` 造**新实例**
 *   ⇒ 端口暴露工厂方法 + 流式句柄（该实例在生成器生命周期内被复用）。
 */

/**
 * AI 服务**流式句柄**（P1）
 * 仅暴露 `research-handlers` 的**被消费面**（`service.stream(...)` 在生成器内被反复消费）。
 */
export interface AiServiceStreamPort {
  /**
   * 原 `service.stream(messages, modelId, { max_tokens: 4000 })`。
   * ⚠️ 原调用点对 `messages` 已显式 `as never` ⇒ 端口形参照旧（`never`）；
   * 返回体按 `AsyncIterable<unknown>` 声明（调用方仅 `for await` + 取 `.content`）。
   */
  stream(
    messages: never,
    modelId: string | undefined,
    options: { max_tokens: number }
  ): AsyncIterable<unknown>;
}

/** 延迟百分位统计（P2；调用方读全部 5 个数值字段 —— 原为 `ReturnType<…>` **类型位**） */
export interface LatencyStatsDto {
  sampleCount: number;
  averageLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
}

/** 模型定价投影（P2；调用方读 `modelId` / `providerId`） */
export interface ModelPricingBriefDto {
  modelId: string;
  providerId: string;
}

/** 供应商投影（P2；调用方读 `id` / `name`） */
export interface ProviderBriefDto {
  id: string;
  name: string;
}

/**
 * 活跃模型投影（P3；调用方读 `modelId` / `capabilities` / `providerId`）
 * ⚠️ 后两者**可缺省** —— 原调用点分别以 `?? []` / `?? ''` 兜底。
 */
export interface ActiveModelBriefDto {
  modelId: string;
  capabilities?: string[] | undefined;
  providerId?: string | undefined;
}

/**
 * 翻译请求**不可信输入**投影（P3）
 * 原调用点对 `JSON.parse` 结果显式 `as Partial<TranslateRequest>` ⇒ 端口按该**收窄后**形态声明。
 */
export interface TranslateRequestDto {
  text?: string | undefined;
  sourceLang?: string | undefined;
  targetLang?: string | undefined;
  model?: string | undefined;
}

/** llama-server 状态投影（P4；调用方读 `status` / `running` / `lastError`） */
export interface LlamaServerStatusDto {
  /** app 侧为字面量联合（原码与 `'error'` 比较）⇒ 收宽为 `string` */
  status: string;
  running: boolean;
  lastError: string | null;
}

/** llama 配置投影（P4；调用方读 `modelsDir` / `model`） */
export interface LlamaConfigBriefDto {
  modelsDir?: string | undefined;
  model?: string | undefined;
}

/** 迁移路径安全检查结果（P4；调用方读 `valid` / `safePath` / `errors`） */
export interface LlamaMigrationSafetyDto {
  valid: boolean;
  safePath?: string | undefined;
  errors: string[];
}

/** 模型下载进度投影（P4；调用方读 `totalMB` / `downloadedMB` / `speedMBs`） */
export interface LlamaDownloadProgressDto {
  totalMB: number;
  downloadedMB: number;
  speedMBs: number;
}

/**
 * llama-server 管理**句柄**（P4）
 *
 * ⚠️ 该句柄是**共享单例**（被 ~9 个 handler 消费、方法族内聚）⇒ 按规则 26 给**句柄**
 * （而非 14 个原子方法）。
 * ⚠️ **句柄方法保持 app 侧的同步/异步形态**（`getConfig` / `getLogContent` / `subscribeLogs`
 * 原为**同步**）—— 句柄**只取一次**，后续调用无需再 `await` ⇒ **调用点零改动**。
 */
export interface LlamaServerManagerPort {
  getStatus(): Promise<LlamaServerStatusDto>;
  /** app 侧为**同步**方法 */
  getConfig(): LlamaConfigBriefDto;
  /** patch 源自 `JSON.parse`（逐字段 `as` 收窄）+ 字面量 ⇒ 实现侧边界收窄 */
  updateConfig(patch: Record<string, unknown>): Promise<unknown>;
  restart(): Promise<void>;
  forceKill(): Promise<{ killed: number }>;
  forceKillAndRestart(): Promise<void>;
  /** app 侧为**同步**方法 */
  getLogContent(maxLines: number): string;
  /** app 侧为**同步**方法（返回**取消订阅**函数） */
  subscribeLogs(onLog: (chunk: string) => void): () => void;
  /**
   * `onProgress` 原形参为 app 侧类型（**类型位** `MigrateProgress`）⇒ 端口收宽为 `unknown`
   * （调用方对 progress 仅 `JSON.stringify`）。
   */
  migrateModels(opts: {
    targetDir: string;
    copy: boolean;
    overwrite: boolean;
    onProgress: (progress: unknown) => void;
    signal: AbortSignal;
  }): Promise<{ success?: boolean | undefined }>;
}

/** AI 运维端口（P1：6 方法；P2 追加 6；P3 追加 4；P4 追加 6 + 4 类型 + 1 句柄） */
export interface AiOpsPort {
  /**
   * 取全局 AI 服务**真句柄**（原 `import('…').aiService`）。
   * ⚠️ 返回 `unknown` 且必须是**原对象** —— 调用方将其**原样透传**给知识库运维端口
   * （`startKnowledgeCompileScheduler` / `runKnowledgeCompile`），包装成替身会在运行期失效。
   */
  getAiServiceHandle(): Promise<unknown>;
  /** 原 `aiService.getDefaultModel()`（app 侧为**同步**代理取值 ⇒ 端口包一层 Promise） */
  getDefaultAiModel(): Promise<string>;
  /** 原 `globalEmbeddingManager.initialize()`（app 侧为**同步返回 Promise** ⇒ 端口 await 后回 `void`） */
  initGlobalEmbedding(): Promise<void>;
  /** 原 `globalEmbeddingManager.embedOne(query)` */
  embedOneText(query: string): Promise<number[]>;
  /** 原 `createAIService({ defaultModel, apiKey })`（**工厂**语义 —— 造新实例，非单例） */
  createAiService(opts: {
    defaultModel: string;
    apiKey: string;
  }): Promise<AiServiceStreamPort>;
  /** 原 `modelRouter.resolveRole(role)`（未配置返回 `''` ⇒ 调用方回退默认路由） */
  resolveRoleModel(role: 'generator' | 'verifier'): Promise<string>;

  // ---- 用量统计 / 计费（P2：`analytics-handlers` + `cost-handlers`）----
  /** 原 `usageStatsService.initialize()` */
  initUsageStats(): Promise<void>;
  /** 原 `usageStatsService.getLatencyStats()`（持久化延迟百分位） */
  getLatencyStats(): Promise<LatencyStatsDto>;
  /** 原 `modelPricingService.initialize()` */
  initModelPricing(): Promise<void>;
  /** 原 `modelPricingService.getAllPricing()` */
  getAllModelPricing(): Promise<ModelPricingBriefDto[]>;
  /** 原 `providerManager.initialize()` */
  initProviders(): Promise<void>;
  /** 原 `providerManager.listProviders()`（不传 filter —— 原调用点即无参） */
  listProviders(): Promise<ProviderBriefDto[]>;

  // ---- 模型类型推导 / 路由接管 / 翻译（P3）----
  /** 原 `activeModelService.getActiveModels()`（调用方读 `modelId` / `capabilities` / `providerId`） */
  listActiveModels(): Promise<ActiveModelBriefDto[]>;
  /** 原 `deriveModelType(capabilities)`（app 侧返回字面量联合 ⇒ 收宽为 `string`） */
  deriveModelTypeOf(capabilities: readonly string[]): Promise<string>;
  /**
   * 原 `tryHandleRoute(req, res)`（**路由接管**语义：`true` = 已处理）。
   * 形参按 node `http` 类型声明 ⇒ 调用方**零 cast**。
   */
  tryHandleAiModelRoute(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<boolean>;
  /**
   * 原 `translationService.translate(request)`（返回 `TranslateResult`，调用方仅 `JSON.stringify`）。
   * ⚠️ `sourceLang` / `targetLang` 原为**语言码联合**（无端口侧静态类型可依）⇒ 实现侧一处边界收窄。
   */
  translateText(request: {
    text: string;
    sourceLang: string;
    targetLang: string;
    model?: string | undefined;
  }): Promise<unknown>;

  // ---- llama.cpp 本地模型（P4：`llama-handlers.ts`，16 处）----
  /** 取 llama-server 管理**单例句柄**（原 `import('…').llamaCppServerManager`） */
  getLlamaManager(): Promise<LlamaServerManagerPort>;
  /** 原 `ensureSafeMigrationPath(targetDir, sourceDir)`（app 侧为**同步**模块函数） */
  ensureSafeLlamaMigrationPath(
    targetDir: string,
    sourceDir: string
  ): Promise<LlamaMigrationSafetyDto>;
  /** 原 `ensureLlamaCppProviderRegistered()` */
  ensureLlamaProviderRegistered(): Promise<boolean>;
  /** 原 `new HardwareDetector().detect({ forceRefresh })` */
  detectLlamaHardware(forceRefresh: boolean): Promise<unknown>;
  /**
   * 原 `detector.detect()` + `new ModelRecommender().recommend(hardware, detector)`。
   * ⚠️ 同一 `HardwareDetector` 实例**既产硬件又作实参** ⇒ **编排内聚实现侧**（规则 20）。
   */
  recommendLlamaModels(): Promise<unknown>;
  /**
   * 原 `new ModelDownloadService().downloadAndConfigure(model, { autoStart, onProgress })`。
   * ⚠️ `model` 源自 `JSON.parse`（逐字段 `as` 收窄）⇒ 实现侧边界收窄。
   */
  downloadLlamaModel(
    model: Record<string, unknown>,
    opts: {
      autoStart?: boolean | undefined;
      onProgress: (p: LlamaDownloadProgressDto) => void;
    }
  ): Promise<Record<string, unknown>>;
}
