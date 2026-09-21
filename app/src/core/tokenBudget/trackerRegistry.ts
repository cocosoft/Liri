/**
 * `UnifiedTokenTracker` 的**模块级访问器**（自 `UnifiedTokenTracker.ts` 抽离）。
 *
 * **为什么抽离**：原文件（含本访问器）达 **819 行**，超出 `lint:size` 的
 * **800 行阈值（阻塞合并，R04-001）**；而该访问器与追踪器实现**无耦合**
 * （只持有一个引用），是天然的分割线。`UnifiedTokenTracker.ts` 以 re-export
 * 保持对外导入路径不变，故所有既有调用方无需改动。
 *
 * 语义（与原实现逐字一致）：由构造方注册当前追踪器；**未注册 ⇒ 返回 `null`**，
 * 调用方据此退化处理（与 `setYieldResumeHandler` / `setActiveSubagentRunProbe` 同法）。
 */

import type { UnifiedTokenTracker } from './UnifiedTokenTracker';

/** 当前追踪器（由构造方注册） */
let currentTracker: UnifiedTokenTracker | null = null;

/** 注册当前追踪器（构造方调用；传 `null` 可卸载） */
export function setUnifiedTokenTracker(
  tracker: UnifiedTokenTracker | null
): void {
  currentTracker = tracker;
}

/** 取当前追踪器（未注册返回 `null`） */
export function getUnifiedTokenTracker(): UnifiedTokenTracker | null {
  return currentTracker;
}
