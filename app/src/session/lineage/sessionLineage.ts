// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 会话血缘链（O10b / 控制面 **Tier1**）—— 祖先会话判定。
 *
 * **与 Tier2 的分工**（O10a）：Tier2 判"请求方是否**就是**归属会话"；本模块判"请求方是否为
 * 归属会话的**祖先**"（会话 fork 会建立 `metadata.parentSessionId` 血缘 ⇒ 祖先会话对后代会话里
 * 跑的子代理，具有与归属会话同等的控制权——例如"父会话中止自己 fork 出来的子会话里的子代理"）。
 *
 * **为什么是运行期链、而不是每次查库**（与 Hermes `max_hops=8` 的等价实现）：
 * - 控制面调用点（`AgentTool.stopAgent`）是**同步**签名，而其全部调用方（HTTP pause/stop、
 *   CLI、Coordinator）不受益于把整条调用链改成 async；
 * - 血缘由 **fork 建立**，进程内即可观测 ⇒ 用 `sessionId → parentSessionId` 的运行期映射即可判定；
 * - Hermes 的 Tier1 用 `WeakRef` 是为了避免其 runtime 持有父 **run 对象**造成泄漏；本实现只存
 *   **字符串 id**（无对象引用）⇒ 天然无保活/泄漏问题，故**无需 WeakRef**（平台差异下的等价形态）。
 *
 * **失效边界（fail-closed，如实声明）**：血缘链只覆盖**本进程内观测到**的 fork；重启后未重新
 * fork 的旧会话不在链上 ⇒ Tier1 判否（**拒绝**，不会误放行），此时 Tier2 归属判定仍照常生效。
 */

/** 血缘链最大跳数（与 Hermes `max_hops=8` 同口径：超过即不认，避免深链/伪造链） */
export const MAX_LINEAGE_HOPS = 8;

/** 运行期血缘：`子会话 id → 父会话 id`（只存 id，不持有会话对象） */
const parentBySession = new Map<string, string>();

/** 登记一条血缘（由会话 fork 处调用；幂等） */
export function registerSessionLineage(
  sessionId: string,
  parentSessionId: string | null | undefined
): void {
  if (!sessionId || !parentSessionId || sessionId === parentSessionId) return;
  parentBySession.set(sessionId, parentSessionId);
}

/** 读取某会话的父会话 id（未登记 ⇒ null） */
export function getSessionParent(sessionId: string): string | null {
  return parentBySession.get(sessionId) ?? null;
}

/** 清空（**仅测试用**） */
export function resetSessionLineage(): void {
  parentBySession.clear();
}

/**
 * 当前运行期血缘链**规模**（已登记的边数）。
 *
 * P2-7（2026-09-25）：供恢复编排层在汇总报告里如实描述 lineage 现状 ——
 * 本模块**不重建**（重启后链为空，fail-closed），故规模只反映"本进程内观测到的 fork 数"。
 */
export function getLineageSize(): number {
  return parentBySession.size;
}

/**
 * `requesterSessionId` 是否为 `ownerSessionId` 的**祖先**（含两者相等）。
 *
 * 从 owner 出发沿父链上溯，逐跳比对；带**访问集**防环（自环/互环都不会死循环）；
 * 超过 `maxHops` 即判否（fail-closed）。
 */
export function isAncestorSession(
  requesterSessionId: string,
  ownerSessionId: string,
  maxHops: number = MAX_LINEAGE_HOPS
): boolean {
  if (!requesterSessionId || !ownerSessionId) return false;
  if (requesterSessionId === ownerSessionId) return true;

  const visited = new Set<string>([ownerSessionId]);
  let current = ownerSessionId;

  for (let hop = 0; hop < maxHops; hop++) {
    const parent = parentBySession.get(current);
    if (!parent) return false;
    if (parent === requesterSessionId) return true;
    if (visited.has(parent)) return false; // 环保护
    visited.add(parent);
    current = parent;
  }
  return false; // 超出最大跳数 ⇒ 不认
}

/**
 * 新增血缘边 `childId → parentId` 是否**会成环**（P1-10 / C 判据）。
 *
 * 两种环（均须拒绝）：
 * - **自环**：`childId === parentId`；
 * - **祖先倒挂**：`childId` 已是 `parentId` 的祖先（`parentId` 在 `childId` 的后代链上）
 *   ⇒ 新边会让两者**互为祖先**（权限面上互相授予控制权）。
 *
 * 为什么需要独立判定：`registerSessionLineage` 只防自环（`sessionId === parentSessionId`），
 * **不防多跳环** —— 它只做 `Map.set`，既不校验链方向也不限制深度。
 */
export function wouldCreateLineageCycle(
  childId: string,
  parentId: string
): boolean {
  if (!childId || !parentId) return false;
  if (childId === parentId) return true;
  return isAncestorSession(childId, parentId);
}

/**
 * `sessionId` 的血缘链深度（自身 = 0，每上溯一跳 +1；带环保护与最大跳数上限）。
 *
 * P1-10 / C 判据：供 fork 判断"新增一条边后是否超过 {@link MAX_LINEAGE_HOPS}"
 * （超深链会被 `isAncestorSession` 判否 ⇒ 与其建一条"查不到"的边，不如建边时就拒绝）。
 */
export function getLineageDepth(
  sessionId: string,
  maxHops: number = MAX_LINEAGE_HOPS
): number {
  if (!sessionId) return 0;
  const visited = new Set<string>([sessionId]);
  let current = sessionId;
  let depth = 0;

  for (let hop = 0; hop < maxHops; hop++) {
    const parent = parentBySession.get(current);
    if (!parent || visited.has(parent)) break;
    visited.add(parent);
    current = parent;
    depth++;
  }
  return depth;
}
