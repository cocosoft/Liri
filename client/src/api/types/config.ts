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
}
