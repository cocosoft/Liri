/**
 * AI 提供商传输抽象基类
 * 对标 Hermes agent/transports/base.py（ProviderTransport ABC）
 *
 * 职责:
 *   convertMessages  — 内部消息格式 → 提供商原生格式
 *   convertTools     — 内部工具定义 → 提供商原生格式
 *   buildRequest     — 构建完整 API 请求参数
 *   normalizeResponse — 提供商原始响应 → NormalizedResponse
 *   extractCacheStats — 提取缓存统计（可选）
 *   mapFinishReason  — 映射停止原因（可选）
 */
import type {
  NormalizedResponse,
  NormalizedUsage,
  TransportRequestParams,
} from './types';

export abstract class BaseTransport {
  /** 提供商标识字符串（与 ProviderRegistry 的 provider.id 对应） */
  abstract readonly provider: string;

  /** 支持的模型列表（用于自动匹配 Transport） */
  abstract readonly supportedModels: string[];

  /**
   * 转换消息列表为提供商原生格式
   * @param messages 内部标准消息 [{role, content}]
   * @returns 提供商原生格式
   */
  abstract convertMessages(
    messages: Array<{ role: string; content: string | null }>
  ): unknown;

  /**
   * 转换工具定义为提供商原生格式
   * @param tools 内部标准工具定义
   * @returns 提供商原生格式
   */
  abstract convertTools(
    tools: Array<{
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    }>
  ): unknown;

  /**
   * 构建完整 API 请求参数
   * @param params 标准化请求参数
   * @returns 提供商 SDK 可直接使用的参数对象
   */
  abstract buildRequest(
    params: TransportRequestParams
  ): Record<string, unknown>;

  /**
   * 归一化提供商原始响应
   * @param raw 提供商 SDK 返回的原始响应对象
   * @returns NormalizedResponse 统一格式
   */
  abstract normalizeResponse(raw: unknown): NormalizedResponse;

  /**
   * 提取缓存统计（可选覆写）
   * 对标 Hermes extract_cache_stats
   * @param raw 提供商原始响应
   * @returns 缓存统计数据，无缓存数据时返回 null
   */
  extractCacheStats(raw: unknown): NormalizedUsage | null {
    return null;
  }

  /**
   * 映射停止原因到标准词汇（可选覆写）
   * 对标 Hermes map_finish_reason
   * @param rawReason 提供商原始停止原因
   * @returns 标准化停止原因
   */
  mapFinishReason(rawReason: string): string {
    return rawReason;
  }

  /**
   * 校验原始响应有效性（可选覆写）
   * @param raw 提供商原始响应
   * @returns 是否有效
   */
  validateResponse(raw: unknown): boolean {
    return true;
  }
}
