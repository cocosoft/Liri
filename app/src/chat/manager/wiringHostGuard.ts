// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * wiringHostGuard — 装配宿主端口的**契约守卫**（issue #16，2026-10-29）
 *
 * ## 为什么需要
 * issue #8 · Cut C 把 `ChatManager` 的构造期装配外移到 `orchestratorHost.ts` / `facadeWiring.ts`，
 * 端口值全部取自宿主的**私有成员**。TypeScript 的私有成员不出现在类型的结构面里 ⇒ 跨模块
 * **无法**做结构校验，只能单点断言。若私有成员被**改名/删除**，断言处不会报错，
 * 运行时得到 `undefined` ⇒ 装配期崩溃或端口静默失效。
 *
 * ## 兑现方式（如实）
 * - **运行期**：`assertHostSurface` 在装配入口按 `*_KEYS` 逐条做**存在性检查**（`key in host`，
 *   含原型上的方法），缺失即**抛错并列出缺失键**（fail-fast，而不是让 `undefined` 流进子门面）；
 * - **编译期**：各装配模块的键表用 `Exclude<keyof XHost, …>` + {@link AssertNever} 做
 *   **全量覆盖检查** —— 接口新增成员而键表漏登记 ⇒ `tsc` 直接报错；
 * - **断言点**：{@link asWiringHost} 是唯一 `as unknown as` 位置，集中审计。
 *
 * 彻底消除断言需把宿主端口改为**公开接口**（约 70 个成员的可见性变更），属 #17 之后的独立决策。
 */

/** 编译期断言：`T` 必须为 `never`（用于「键表必须覆盖接口全部成员」） */
export type AssertNever<T extends never> = T;

/**
 * 单点断言：把宿主实例视为装配视图。
 *
 * ⚠️ 该转换**不**做校验；契约由调用方在入口调用 {@link assertHostSurface} 兑现。
 */
export function asWiringHost<H extends object>(host: object): H {
  return host as unknown as H;
}

/**
 * 装配入口的**存在性**守卫：`requiredKeys` 任一不在宿主上（含原型链）⇒ 抛错。
 *
 * 用 `key in host` 而非值判空：`llmClient` / `onTurnEnd` 等成员在构造期**尚未赋值**但确实存在，
 * 值判空会误报；而改名/删除会让键**彻底不存在**，正是要拦住的情形。
 */
export function assertHostSurface(
  host: object,
  requiredKeys: readonly string[],
  scope: string
): void {
  const missing = requiredKeys.filter((key) => !(key in host));
  if (missing.length > 0) {
    throw new Error(
      `${scope}: 宿主端口缺失 [${missing.join(', ')}] —— 私有成员被改名/删除？（issue #16 装配契约守卫）`
    );
  }
}
