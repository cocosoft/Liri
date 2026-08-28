export type BillingMode = "token" | "per_request" | "token_and_per_request";

export interface TimeBasedPrice {
  start: string; // "HH:mm"
  end: string; // "HH:mm"；end < start 表示跨天
  inputCostPerMillion?: number;
  outputCostPerMillion?: number;
  cacheReadCostPerMillion?: number;
  cacheWriteCostPerMillion?: number;
}

export interface ModelInfo {
  id: string; // UUID（后端返回）—— BREAKING CHANGE: 原为模型名
  modelId: string; // 模型名（新增）
  name: string;
  provider: string;
  providerId?: string;
  type: "chat" | "embedding" | "image" | "video" | "voice";
  context_length: number;
  enabled: boolean;
  requiresAuth?: boolean;
  pricing?: {
    inputPer1M?: number;
    outputPer1M?: number;
    cacheReadPer1M?: number;
    cacheWritePer1M?: number;
    billingMode?: BillingMode;
    pricePerRequest?: number;
    timeBasedPricing?: TimeBasedPrice[];
    /** 定价来源：official=官方价格自动同步 / manual=用户手工配置（官方同步不覆盖） */
    pricingSource?: string;
  };
}

export type ProviderCategory =
  "official" | "aggregator" | "third_party" | "cn_official";

export interface ProviderInfo {
  id: string;
  name: string;
  providerType: string;
  baseUrl: string;
  /** P0 凭据迁移：已配置时为脱敏掩码（非明文），未配置为 undefined */
  apiKey?: string;
  /** P0 凭据迁移：真实凭据是否已配置（安全判断用，替代 apiKey truthy） */
  hasKey?: boolean;
  modelsUrl?: string;
  isActive: boolean;
  sortIndex: number;
  requiresAuth: boolean;
  notes?: string;
  icon?: string;
  iconColor?: string;
  category?: ProviderCategory;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderFormData {
  name: string;
  providerType: string;
  baseUrl: string;
  /**
   * P0 凭据迁移：
   * - 新增时：传新 key
   * - 编辑时：非空=更新 key；空串=保留现有；null=清除
   */
  apiKey: string | null;
  modelsUrl: string;
  notes: string;
  requiresAuth: boolean;
  icon?: string;
  iconColor?: string;
  category?: ProviderCategory;
  /** D9 乐观并发：编辑时携带更新前读取的 updatedAt，后端 stale write 拒绝返回 409 */
  expectedRevision?: number;
}

export interface ProviderPreset {
  name: string;
  websiteUrl?: string;
  apiKeyUrl?: string;
  settingsConfig: ProviderFormData;
  isOfficial: boolean;
  category: ProviderCategory;
  apiFormat: "openai" | "anthropic" | "google" | "custom";
  providerType: string;
  requiresOAuth: boolean;
  modelsUrl?: string;
  endpointCandidates?: string[];
  theme?: {
    icon: string;
    backgroundColor: string;
    textColor: string;
  };
}

export interface EndpointLatency {
  url: string;
  latency?: number;
  status?: number;
  error?: string;
}

export interface CurrentModelInfo {
  modelId: string; // 模型名
  modelUuid: string; // UUID
  provider: string;
  routerTier?: string;
  routingMode?: "dynamic" | "static" | "off";
  taskType: string;
  costThisSession: number;
  availableTasks: Array<{ type: string; label: string; icon: string }>;
  isNonChat?: boolean; // 模型是否有非聊天能力标签，前端据此显示警告
}

export interface TaskModelConfig {
  default?: string;
  chat?: string;
  coding?: string;
  translation?: string;
  quick?: string;
  agent?: string;
  scheduled?: string;
  local?: string;
  embedding?: string;
  image?: string;
  vision?: string;
  ocr?: string;
  text_to_video?: string;
  image_to_video?: string;
  video?: string;
  tts?: string;
  stt?: string;
  reranking?: string;
  knowledge_compile?: string;
}

export interface TaskDefinition {
  type: string;
  label: string;
  description: string;
  icon: string;
}

export interface FetchedModel {
  id: string;
  ownedBy?: string;
}
