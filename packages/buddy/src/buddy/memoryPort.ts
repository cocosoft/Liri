/**
 * 伙伴读记忆端口（2026-11-25，`.trae/specs/dream-buddy-wiring.md` P2-1）
 *
 * 消费方声明最小契约：buddy 包**不直接依赖**记忆实现，也不使用隐式全局单例；
 * 由 app 组合根（`entrypoints/init.ts`）注入真实实现（`MemoryManager`）。
 * 未注入 ⇒ 伙伴不引用记忆，行为与接线前一致（不静默伪造记忆）。
 */

/** 单条记忆摘要（buddy 侧只读展示所需的最小字段） */
export interface BuddyMemoryDigest {
  /** 记忆名称（`MEMORY.md` 索引条目标题） */
  name: string;
  /** 记忆描述（索引条目的一行钩子） */
  description: string;
}

/** 记忆读取端口 */
export interface BuddyMemoryPort {
  /** 按更新时间倒序取最近 N 条记忆 */
  getRecentMemories(limit: number): Promise<BuddyMemoryDigest[]>;
}

let injectedPort: BuddyMemoryPort | null = null;

/** 注入实现（传 null 撤回注入）；由 app 组合根在启动期调用 */
export function setBuddyMemoryPort(port: BuddyMemoryPort | null): void {
  injectedPort = port;
}

/** 取当前实现（未注入 ⇒ null） */
export function getBuddyMemoryPort(): BuddyMemoryPort | null {
  return injectedPort;
}
