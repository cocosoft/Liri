/**
 * 延迟Schema加载工具
 * 返回一个记忆化工厂函数，在第一次调用时构造值
 * 用于将Zod schema构造从模块初始化时间延迟到第一次访问
 * 参考CC源码 cc_code/backend/utils/lazySchema.ts 实现
 */

/**
 * 延迟Schema工厂函数
 * @param factory Schema工厂函数
 * @returns 记忆化的工厂函数
 */
export function lazySchema<T>(factory: () => T): () => T {
  let cached: T | undefined;
  return () => (cached ??= factory());
}
