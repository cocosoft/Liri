/**
 * Store 代理包装器 — 批量拦截 Store 异步方法，自动注入 OTel Span
 *
 * 用法：
 *   import { instrumentStore } from "../monitoring/otel/instrumentStore";
 *
 *   const methods = { switchSession, createSession, deleteSession };
 *   export const useStore = create((set, get) => ({
 *     ...instrumentStore("session", methods, [
 *       "switchSession", "createSession", "deleteSession",
 *     ]),
 *   }));
 *
 * 注意：与 Service 层 asyncWrap 可能产生双重 Span，P2 阶段将通过 SpanCoverageRegistry 去重。
 */

import { getOTelTracing } from "./OTelTracing";

/**
 * 批量拦截 Store 异步方法，自动注入 OTel Span
 *
 * @param name    Store 名称（用于 Span 命名：stores:{name}:{method}）
 * @param store   Store 方法对象
 * @param methods 需要追踪的方法名列表
 * @returns 包装后的方法对象
 */
export function instrumentStore<T extends Record<string, unknown>>(
  name: string,
  store: T,
  methods: (keyof T)[],
): T {
  const tracing = getOTelTracing();
  const wrapped = { ...store };

  for (const method of methods) {
    const original = store[method];
    if (typeof original !== "function") continue;

    (wrapped as Record<string, unknown>)[method as string] = (
      ...args: unknown[]
    ) => {
      return tracing.asyncWrap(`stores:${name}:${String(method)}`, () =>
        (original as Function).apply(store, args),
      );
    };
  }

  return wrapped;
}
