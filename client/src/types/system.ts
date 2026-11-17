/**
 * 系统/API/监控领域类型
 *
 * 由 api.ts + monitor.ts 归并（GR15-002）。
 */

// ─── API 响应类型 ───

/** API 错误结构 */
export interface ApiError {
  code: number;
  message: string;
  /**
   * 后端结构化错误体（`{ error: { code, message, ... } }` 的解析结果）。
   *
   * 为什么需要：`message` 只能承载一句话，而部分写接口的**分支决策**依赖结构化字段
   * （如规则写接口 409 的 `error.code === 'impact'` + `error.impact`）。仅靠 message
   * 字符串判断属于「用文案做状态判断」（`CS02`），故保留原始解析结果。
   * 非 JSON 错误体 / 非对象时缺省。
   */
  payload?: unknown;
}

/** 统一 API 响应包装 */
export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: ApiError;
}

/** 类型守卫：判断一个对象是否为 ApiResponse 实例 */
export function isApiResponse<T>(value: unknown): value is ApiResponse<T> {
  if (value === null || value === undefined) return false;
  if (typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.ok === "boolean" &&
    (obj.error === undefined || typeof obj.error === "object")
  );
}

/** 安全解包 ApiResponse：成功返回 data，失败抛出带 message 的 Error */
export function unwrapApiResponse<T>(response: ApiResponse<T>): T {
  if (!response.ok || !response.data) {
    const message = response.error?.message ?? "未知错误";
    throw new Error(message);
  }
  return response.data;
}

// ─── 监控 ───

export interface MetricPoint {
  timestamp: number;
  value: number;
  labels?: Record<string, string>;
}

export interface Alert {
  id: string;
  level: "info" | "warn" | "error" | "critical";
  message: string;
  timestamp: number;
  acknowledged: boolean;
  source?: string;
}

export type LogSource =
  "logger" | "structured" | "otel" | "llm" | "context" | "runlog" | "all";

export interface LogEntry {
  id: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  timestamp: number;
  source: string;
  module?: string;
  details?: string;
  traceId?: string;
  spanId?: string;
}

export interface SystemHealth {
  status: "healthy" | "degraded" | "unhealthy";
  components: {
    name: string;
    status: "ok" | "warning" | "error";
    message?: string;
  }[];
  timestamp: number;
}
