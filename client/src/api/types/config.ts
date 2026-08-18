/**
 * API 请求/响应类型 —— config 模块
 */

export interface AppConfig {
  /** HTTP 监听端口 */
  httpPort?: number;
  /** 主题 */
  theme?: "light" | "dark";
  /** 语言 */
  locale?: string;
  /** 后端地址 */
  backendUrl?: string;
  [key: string]: unknown;
}

export interface BackendStatus {
  running: boolean;
  port: number | null;
  pid?: number | null;
  exit_code?: number | null;
  error?: string | null;
  /** 共享密钥（Rust start_backend/get_backend_status 返回，用于直连 fetch 注入 X-API-Key） */
  secret?: string | null;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  providerId?: string;
  type: "chat" | "embedding" | "image";
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

export interface ProviderInfo {
  id: string;
  name: string;
  providerType: string;
  baseUrl: string;
  apiKey?: string;
  isActive: boolean;
  sortIndex: number;
  requiresAuth: boolean;
  createdAt: number;
  updatedAt: number;
}
