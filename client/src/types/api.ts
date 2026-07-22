/**
 * API 响应类型定义
 *
 * 统一前后端 HTTP 响应格式，所有服务层方法返回 ApiResponse<T>
 */

/** API 错误结构 */
export interface ApiError {
  code: number;
  message: string;
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
