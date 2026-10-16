/**
 * 「编辑并另存为分支」的**零历史**判定（真机缺陷修复，2026-10-16）。
 *
 * 缺陷：该流程原实现是「fork 全量历史 → 切到新会话 → 由 `streamMessage` 的 `editTruncate`
 * 从编辑点截断」。真机复验（会话 `session_mvaarhkm037069ccfb` → 分支 `597e566e-…`）证明
 * 事后截断在**新会话**恒被后端 404（`Target message not found`）⇒ 截断落空 ⇒ 分支重载后
 * **旧消息回显**（编辑前的 `第二问` 与其回复仍在，轮次 3 而非 2）。
 *
 * 已修且真机验证通过的部分：**编辑首条消息 ⇒ 零历史**（不该 fork 全量）。
 *  * 复验逐字：分支初始 `loadConversation: … messageCount: 0`；三处失败痕迹
 *    （`streamMessage:editTruncate` / `Target message not found` / `branchBoundary` warn）
 *    **零命中**；重载后仅 `甲-改`+其回复（1 轮），无 `甲`。
 *
 * **为什么不在此处算"前缀边界"（重要，勿轻率补回）**：曾尝试用「编辑点前一条的
 * `lastEventSeq`」当 fork 的 `boundary`，真机即被打回 ——
 *  ① 实测该字段常为 `null`（`prevSeq: null`，事件派生路径的消息不携带写盘戳）；
 *  ② 更根本：`withPaginationSeq` 会给**缺 seq** 的消息**按数组顺序合成**序号 —— 那是
 *     "消息分页游标"语义，**不是真实事件 seq**，拿它当 `boundary` 会切在错误位置；
 *  ③ 即便拿到真实写盘戳，它也是"写盘时刻的会话 tail seq"，可能落在**未闭合 turn 内**
 *     而被后端 400（`fork` 的 open-turn 校验）。
 * ⇒ 正确的边界只能由**后端在源会话上**解析（源会话里编辑点的 messageId 是有效的）：
 * 建议给 `fork` 增加参数（如 `truncateAfterMessageId`），由后端把该消息映射到事件 seq
 * 再 `copyPrefixTo [1..seq-1]`。在此之前，非首条编辑**保持既有行为**并留痕（本文件返回
 * `fallback`），不做不可信的猜测。
 */

import { createLogger } from "@/utils/logger";

const logger = createLogger("stores:chat:branchBoundary");

interface Identifiable {
  id: string;
}

export type BranchBoundaryPlan =
  /** 编辑点就是首条 ⇒ 零历史（建空会话即可，不要 fork 全量） */
  | { kind: "empty" }
  /** 无法在客户端安全判定 ⇒ 调用方退回既有行为（并已知其可能回显旧消息） */
  | { kind: "fallback" };

/**
 * 判定「编辑并另存为分支」是否属于**零历史**场景。
 *
 * @param sourceMessages 源会话**当前已加载**的消息列表（顺序即会话顺序）
 * @param editTarget 编辑点（源会话中的消息）
 */
export function resolveBranchBoundary<T extends Identifiable>(
  sourceMessages: readonly T[],
  editTarget: { id: string } | null | undefined,
): BranchBoundaryPlan {
  if (!editTarget) return { kind: "fallback" };

  const index = sourceMessages.findIndex((m) => m.id === editTarget.id);
  if (index === 0) return { kind: "empty" };

  // 含 index<0（不在已加载列表）与 index>0（需要"编辑点之前的事件边界"）：
  // 后者需后端按源会话 messageId 解析（见文件头注），客户端不自算。
  logger.warn(
    "分支边界：非首条编辑需后端解析事件边界（本轮未实现）⇒ 退回既有行为",
    {
      editTargetId: editTarget.id,
      index,
      sourceCount: sourceMessages.length,
    },
  );
  return { kind: "fallback" };
}
