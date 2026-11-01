/**
 * 记忆窄端口契约（Read / Write / Search / Forget）
 *
 * T-①07（A5 记忆分层收敛，spec `.trae/specs/memory-port-unification.md`）：
 * 把"记忆能做什么"从**全能型死契约**（`memory/MemoryManager.ts:72` 的 `interface MemoryManager`
 * —— 声明 ~40 方法、**无任何 implement**、且近半方法在实现类中并不存在）收敛为**按能力切分**的
 * 四个窄端口。
 *
 * 设计约束（取证结论，2026-10-03）：
 * 1. **只收实现类真实具备的能力** —— 死契约里的 `createMemoryFromChat` / `searchMemoriesBySemantic`
 *    / `searchMemoriesByTags` / `generateMemoryPrompts` / 全部团队记忆与自动记忆方法，在
 *    `MemoryManagerImpl` 中**均不存在** ⇒ 一律**不**纳入端口，避免制造"空桩"；
 * 2. 每个方法的**真实实现者**在下方逐条标注（`memory/MemoryManager.ts` 行号；**2026-10-06 复核订正**
 *    —— 原标注已整体陈旧约 +14 行，见 `.trae/specs/memory-port-unification.md`）；
 *
 * 布局说明：原计划拆 4 个文件，实测触发门禁 `R06-009-1`（4 个 <40 行微文件，要求聚合）
 * ⇒ 按门禁指引**聚合为本文件**。
 */
import type { Memory, MemoryStats } from '../types/Memory';

/** 记忆读端口 —— 实现者：`getMemory:559` · `getAllMemories:765` · `getMemoryStats:788` */
export interface MemoryReadPort {
  /** 按 id 读取单条记忆；不存在返回 null */
  getMemory(id: string): Promise<Memory | null>;

  /** 读取全部记忆（实现侧会先 flush 待写入批次，保证磁盘与运行时一致） */
  getAllMemories(): Promise<Memory[]>;

  /** 记忆统计（总数 / 按类型分布 / 最近数量等） */
  getMemoryStats(): Promise<MemoryStats>;
}

/**
 * 记忆写端口 —— 实现者：`createMemory:395` · `updateMemory:570` · `deleteMemory:617`
 * · `deleteAllMemories:638` · `setMemoryExpiry:986`
 */
export interface MemoryWritePort {
  /** 新建记忆（id / createdAt / updatedAt 由实现侧生成） */
  createMemory(
    memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Memory>;

  /** 局部更新已存在的记忆 */
  updateMemory(id: string, updates: Partial<Memory>): Promise<Memory>;

  /** 删除单条记忆 */
  deleteMemory(id: string): Promise<void>;

  /** 删除全部记忆，返回删除条数（破坏性操作，调用方须自行确认） */
  deleteAllMemories(): Promise<number>;

  /** 设置过期时间（语义是"写属性"；与 `MemoryForgetPort` 的老化清理相邻） */
  setMemoryExpiry(id: string, expiresAt: Date): Promise<Memory>;
}

/** 记忆检索端口 —— 实现者：`getRelevantMemories:669`（hybridSearch + 关联图扩展 + LLM 精选） */
export interface MemorySearchPort {
  /**
   * 检索与 query 相关的记忆。
   * @param query 查询文本
   * @param limit 返回条数上限（实现侧默认 5）
   */
  getRelevantMemories(query: string, limit?: number): Promise<Memory[]>;
}

/** 记忆遗忘端口 —— 实现者：`cleanupExpiredMemories:872`（并发安全：已有清理执行中则返回 0） */
export interface MemoryForgetPort {
  /** 清理已过期记忆，返回被清理条数 */
  cleanupExpiredMemories(): Promise<number>;
}
