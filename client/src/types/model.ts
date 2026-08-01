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
  };
}

export type ProviderCategory =
  "official" | "aggregator" | "third_party" | "cn_official";

export interface ProviderInfo {
  id: string;
  name: string;
  providerType: string;
  baseUrl: string;
  apiKey?: string;
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
  apiKey: string;
  modelsUrl: string;
  notes: string;
  requiresAuth: boolean;
  icon?: string;
  iconColor?: string;
  category?: ProviderCategory;
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
