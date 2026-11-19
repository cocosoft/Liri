// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 自唤醒 ↔ Cron 的**接线注册槽**（2026-11-19）。
 *
 * 为什么需要它：CG3 自唤醒的"到期扫描"挂在 `CronScheduler.extraTick` 上，而两侧启动顺序不定
 * （`startCg3` 在初始化管线；全局 cron 在 REPL/DAEMON 更晚建立）。若让
 * `GlobalCronScheduler` 直接动态 import `Cg3Bootstrap` 就会成环
 * （madge 实测：`tasks/cron/GlobalCronScheduler.ts > tasks/Cg3Bootstrap.ts`）⇒ CI「Check circular
 * dependencies (baseline at most 0)」红。
 *
 * 故本条只放一个**无依赖的注册槽**：
 * - CG3 创建时 `registerSelfWakeCronWire(...)` 登记接线函数（此刻 cron 可能还没起）；
 * - cron 启动后 `applySelfWakeCronWire()` 调用它（幂等由 `wireSelfWakeToCron` 的 WeakSet 保证）。
 */

/** 接线函数：把 SelfWake 接到已启动的调度器；返回是否接上 */
export type SelfWakeCronWire = () => Promise<boolean>;

let wire: SelfWakeCronWire | null = null;

/** 登记接线函数（`createCg3Services` 调用；重复登记以最后一次为准） */
export function registerSelfWakeCronWire(fn: SelfWakeCronWire): void {
  wire = fn;
}

/** 应用接线（cron 启动后调用；未登记 ⇒ false，不伪造成功） */
export async function applySelfWakeCronWire(): Promise<boolean> {
  if (!wire) return false;
  return wire();
}
