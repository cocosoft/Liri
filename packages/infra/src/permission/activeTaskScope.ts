// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * activeTaskScope —— 「会话当前活跃长程任务」的**端口**（P2，2026-11-04，方案 §3.3）
 *
 * 用途：任务档审批（`scopeKind:'task'`）需要在**判定/查询时**知道"这个会话现在跑的是哪个任务"，
 * 而权限层（infra）不能反向依赖 tasks（app）。因此由 app 装配期注册一个纯查表函数，
 * 权限层按 `sessionId` 取用。
 *
 * 未注册（CLI / 测试 / 未走 chat 装配）⇒ 一律 `undefined` ⇒ 任务档条目**不会命中**
 * （fail-closed：只会多问一次，不会越权放行）。
 */

/** `sessionId → 活跃任务 id`（无活跃任务 ⇒ `undefined`） */
export type ActiveTaskIdResolver = (sessionId: string) => string | undefined;

let resolver: ActiveTaskIdResolver | undefined;

/** 注册/注销解析器（装配期调用一次；`undefined` = 注销，供测试隔离） */
export function setActiveTaskIdResolver(
  next: ActiveTaskIdResolver | undefined
): void {
  resolver = next;
}

/**
 * 取会话当前活跃任务 id。
 *
 * 解析器抛错 ⇒ `undefined`（审批路径不得因查表失败而放行或崩溃）。
 */
export function getActiveTaskId(sessionId: string | undefined): string | undefined {
  if (!sessionId || !resolver) return undefined;
  try {
    return resolver(sessionId);
  } catch {
    // @ignore-catch — 查表失败按"无活跃任务"处理（任务档不命中，最多多弹一次卡）
    return undefined;
  }
}
