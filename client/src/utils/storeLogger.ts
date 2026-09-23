/**
 * Store 状态变更日志工具
 *
 * 为 Zustand Store 添加开发环境的状态变更日志，用于调试。
 * 仅在 import.meta.env.DEV 时生效。
 *
 * 使用方式：
 *   import { withStoreLogging } from "../utils/storeLogger";
 *   withStoreLogging(useChatStore, "chatStore", ["sendMessage"]);
 */

/* eslint-disable no-console -- 本文件即调试日志工具实现：以 %c 样式直写 console（Dev-only），非业务日志 */

import type { StoreApi } from "zustand";

/**
 * 为指定 Store 订阅状态变更日志
 *
 * @param store - Zustand store（useXxxStore 本身）
 * @param name  - Store 名称，用于日志前缀
 * @param ignore - 忽略的 key 列表（高频变化字段，如 _navigate、loading 等）
 */
export function withStoreLogging<T extends object>(
  store: StoreApi<T>,
  name: string,
  ignore: string[] = [],
): void {
  if (!import.meta.env.DEV) return;

  const ignored = new Set<string>(ignore);

  store.subscribe((state, prev) => {
    const changed: string[] = [];

    for (const key of Object.keys(state)) {
      if (ignored.has(key)) continue;
      if (state[key as keyof T] !== prev[key as keyof T]) {
        changed.push(key);
      }
    }

    if (changed.length > 0) {
      console.log(
        `%c[${name}] %c${changed.join(", ")}`,
        "color:#8b5cf6;font-weight:bold",
        "color:#a78bfa",
      );
    }
  });
}
