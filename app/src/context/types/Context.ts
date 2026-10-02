/**
 * 2026-10-01 B14（子批 F `session -> context` 收敛）A′ 步 —— 原址转出。
 *
 * `Context` 家族 5 个类型已**下沉至类型中心** `src/types/context.ts`（core 层）：
 * 原文件为**纯类型、零出向依赖** ⇒ 下沉净差 0（不新增任何跨层边）。
 *
 * 本文件保留为**再导出 shim**，使 `context/**` 既有消费方零改动。
 * 依 R05-013 处置口径：**再导出不计入类型中心冲突**（合法手法）。
 */
export type {
  Context,
  SessionContext,
  TeammateContext,
  UserContext,
  WorkloadContext,
} from '../../types/context';
