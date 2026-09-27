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

/**
 * 追踪器的**最小结构契约**（2026-09-26 断环）。
 *
 * **为什么用结构型，而不是 `import type { UnifiedTokenTracker }`**：
 * 后者会与 `UnifiedTokenTracker.ts` 构成
 * `UnifiedTokenTracker → trackerRegistry`（自注册）与 `trackerRegistry → UnifiedTokenTracker`（类型）
 * 两条互为反向的边 ⇒ `madge --circular` 计为一条**环**（它把 `import type` 也计环），
 * 撞上 CI 的循环依赖门禁（10 > 基线 7）。
 * 本访问器只需要"持有并交还一个引用"，故只声明**被引用到的成员**（实测全仓仅
 * `AgentTool` 用 `getCurrentInputTokens`）；将来若调用方需要更多成员，在此按需追加即可
 * （结构型 ⇒ 实现类无需改动）。
 */
export interface RegisteredTracker {
  /** 当前输入 token 基线（按会话；未评估过 ⇒ undefined） */
  getCurrentInputTokens(sessionId?: string): number | undefined;
}

/** 当前追踪器（由构造方注册） */
let currentTracker: RegisteredTracker | null = null;

/** 注册当前追踪器（构造方调用；传 `null` 可卸载） */
export function setUnifiedTokenTracker(
  tracker: RegisteredTracker | null
): void {
  currentTracker = tracker;
}

/** 取当前追踪器（未注册返回 `null`） */
export function getUnifiedTokenTracker(): RegisteredTracker | null {
  return currentTracker;
}
