/**
 * Anthropic 提示缓存配置
 * 对标 Hermes agent/prompt_caching.py 的 system_and_3 策略
 * 为系统提示、消息和工具定义添加 cache_control 断点
 */

/**
 * 缓存断点位置
 */
export interface CacheBreakpoint {
  type: 'system' | 'message' | 'tools';
  index: number;
}

/**
 * 缓存策略类型
 */
export type CacheStrategy =
  | 'system_and_3'
  | 'system_and_6'
  | 'system_only'
  | 'none';

/**
 * 缓存配置
 */
export interface PromptCacheConfig {
  strategy: CacheStrategy;
  breakpointInterval: number;
  maxBreakpoints: number;
}

/**
 * 默认缓存配置 - system_and_3 策略
 * 系统提示末尾 + 每 3 条消息 + 工具定义末尾
 */
export const DEFAULT_CACHE_CONFIG: PromptCacheConfig = {
  strategy: 'system_and_3',
  breakpointInterval: 3,
  maxBreakpoints: 4,
};

/**
 * 支持提示缓存的模型列表
 * 仅 Claude 3.5 Sonnet 及以上支持
 */
export const CACHE_SUPPORTED_MODELS: string[] = [
  'claude-3-5-sonnet-20241022',
  'claude-3-5-haiku-20241022',
  'claude-sonnet-4-6',
  'claude-sonnet-4-5-20250929',
  'claude-haiku-4-5-20251001',
  'claude-opus-4-6',
  'claude-opus-4-5-20251101',
];

/**
 * 检查模型是否支持提示缓存
 * @param model 模型名称
 * @returns 是否支持
 */
export function isCacheSupported(model: string): boolean {
  return CACHE_SUPPORTED_MODELS.includes(model);
}

/**
 * 根据策略计算缓存断点位置
 * @param messageCount 消息总数
 * @param config 缓存配置
 * @returns 缓存断点位置数组
 */
export function calculateBreakpoints(
  messageCount: number,
  config: PromptCacheConfig = DEFAULT_CACHE_CONFIG
): CacheBreakpoint[] {
  if (config.strategy === 'none' || messageCount === 0) {
    return [];
  }

  const breakpoints: CacheBreakpoint[] = [];

  if (config.strategy === 'system_only') {
    breakpoints.push({ type: 'system', index: 0 });

    return breakpoints;
  }

  breakpoints.push({ type: 'system', index: 0 });

  let breakpointCount = 1;

  for (
    let i = 0;
    i < messageCount && breakpointCount < config.maxBreakpoints;
    i++
  ) {
    if (config.strategy === 'system_and_3') {
      if ((i + 1) % config.breakpointInterval === 0) {
        breakpoints.push({ type: 'message', index: i });
        breakpointCount++;
      }
    } else if (config.strategy === 'system_and_6') {
      if ((i + 1) % 3 === 0 || (i + 1) % 6 === 0) {
        breakpoints.push({ type: 'message', index: i });
        breakpointCount++;
      }
    }
  }

  breakpoints.push({ type: 'tools', index: 0 });

  return breakpoints;
}

/**
 * 判断指定消息索引是否应放置缓存断点
 * @param messageIndex 消息索引（从 0 开始）
 * @param breakpoints 缓存断点列表
 * @returns 是否应放置断点
 */
export function shouldPlaceBreakpoint(
  messageIndex: number,
  breakpoints: CacheBreakpoint[]
): boolean {
  return breakpoints.some(
    (bp) => bp.type === 'message' && bp.index === messageIndex
  );
}

/**
 * 判断是否应放置系统断点
 * @param breakpoints 缓存断点列表
 * @returns 是否应放置
 */
export function shouldPlaceSystemBreakpoint(
  breakpoints: CacheBreakpoint[]
): boolean {
  return breakpoints.some((bp) => bp.type === 'system');
}

/**
 * 判断是否应放置工具断点
 * @param breakpoints 缓存断点列表
 * @returns 是否应放置
 */
export function shouldPlaceToolsBreakpoint(
  breakpoints: CacheBreakpoint[]
): boolean {
  return breakpoints.some((bp) => bp.type === 'tools');
}

/**
 * 创建 Anthropic cache_control 对象
 * @returns cache_control 对象
 */
export function createCacheControl(): { type: 'ephemeral' } {
  return { type: 'ephemeral' };
}
