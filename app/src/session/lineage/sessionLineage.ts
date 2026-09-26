// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 会话血缘链（O10b / 控制面 **Tier1**）—— 祖先会话判定。
 *
 * **与 Tier2 的分工**（O10a）：Tier2 判"请求方是否**就是**归属会话"；本模块判"请求方是否为
 * 归属会话的**祖先**"（会话 fork 会建立 `metadata.parentSessionId` 血缘 ⇒ 祖先会话对后代会话里
 * 跑的子代理，具有与归属会话同等的控制权——例如"父会话中止自己 fork 出来的子会话里的子代理"）。
 *
 * **为什么是运行期链、而不是每次查库**：
 * - 控制面调用点（`AgentTool.stopAgent`）是**同步**签名，而其全部调用方（HTTP pause/stop、
 *   CLI、Coordinator）不受益于把整条调用链改成 async；
 * - Hermes 的 Tier1 用 `WeakRef` 是为了避免其 runtime 持有父 **run 对象**造成泄漏；本实现只存
 *   **字符串 id**（无对象引用）⇒ 天然无保活/泄漏问题，故**无需 WeakRef**（平台差异下的等价形态）。
 *
 * **跨进程语义（P3-1 修复，2026-09-26）**：链是**运行期**的，但**启动期会从盘重建**
 * （`rebuildSessionLineage()`，数据源 = 各会话的 `metadata.parentSessionId`）⇒ fork 关系**不再
 * 因进程重启而丢失**。
 *
 * **仍然 fail-closed 的边界（如实声明）**：**重建不到**的边 —— 元数据缺失、边被净化丢弃
 * （环 / 超深）、或重建整体失败 —— 一律**判否（拒绝）**，**不会误放行**；此时 Tier2 归属判定
 * 照常生效。
 *
 * ⚠️ **历史说明**：修复前链**只覆盖本进程内观测到的 fork**，重启后链为空 ⇒ 除控制面误拒外，
 * `forkSession` 的**环/深度守卫**（见 `SessionGateway` 的 `wouldCreateLineageCycle` /
 * `getLineageDepth` 调用）也一并被弱化（可建出超深链或互为祖先的环）。启动期重建同时消除这两类后果。
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

// ─────────────────────────────────────────────────────────────────────────────
// P3-1（2026-09-26）：**启动期从盘重建**（裁定 A）
// ─────────────────────────────────────────────────────────────────────────────

/** 重建输入：一条"子会话 → 其父会话"的候选边（来自会话 `metadata.parentSessionId`） */
export interface LineageRebuildEntry {
  id: string;
  parentSessionId?: string | null;
}

/** 被**净化丢弃**的边（丢弃 = 该边不可见 ⇒ 更可能判否，属 fail-closed 方向） */
export interface LineageRebuildDroppedEdge {
  childId: string;
  parentId: string;
  reason: 'self' | 'cycle' | 'too-deep';
}

export interface LineageRebuildStats {
  /** 扫描到的会话条目数 */
  scanned: number;
  /** 实际登记的边数 */
  registered: number;
  /**
   * 被净化丢弃的边。
   * ⚠️ **不含** `parent-unknown` —— 按裁定（2026-09-26）"父会话已不在盘上"的边**视为链头保留**
   * （保住链形状与深度计数，避免跨重启后 `MAX_LINEAGE_HOPS` 被绕过）。
   */
  dropped: LineageRebuildDroppedEdge[];
  /** 重建后链规模 */
  size: number;
}

/**
 * 从盘上数据**重建**血缘链（启动期调用；**幂等**：先 `resetSessionLineage()` 再灌入）。
 *
 * 算法（**与入参顺序无关**，见下方多轮插入）：
 * 1. 收边：忽略空 `id` / 空 `parent`，自环单独记为 `self`；
 * 2. **多轮稳定插入** —— 仅当"父**已登记**"或"父**不在候选集**（链头 / parent-unknown）"时才登记该边
 *    ⇒ 天然"父在子先"，且对入参顺序不敏感；
 * 3. 每登记一条前先过**既有守卫**：`wouldCreateLineageCycle` ⇒ 丢 `cycle`；`getLineageDepth(parent)+1
 *    > MAX_LINEAGE_HOPS` ⇒ 丢 `too-deep`（与 `forkSession` 用**同一套判据**，故重建后 fork 守卫行为与
 *    "重启前同一进程内"一致）；
 * 4. 多轮后仍无法推进的边（只可能来自**环**）⇒ 末轮按插入顺序处理：能登记的先登记、成环的丢弃
 *    ⇒ 结果确定（同一入参 ⇒ 同一结果）。
 *
 * **为什么要净化**：盘上数据可能来自旧版本/手工编辑/历史缺陷 ⇒ 直接灌入会让**环**与**超深链**在重建后
 * 长期生效（把守卫弱化固化成常态）。丢弃是 fail-closed 方向（丢边只会更可能判否）。
 */
export function rebuildSessionLineage(
  entries: readonly LineageRebuildEntry[]
): LineageRebuildStats {
  resetSessionLineage();

  const dropped: LineageRebuildDroppedEdge[] = [];
  const pending = new Map<string, string>();

  for (const entry of entries) {
    const parentId = entry.parentSessionId;
    if (!entry.id || !parentId) continue;
    if (entry.id === parentId) {
      dropped.push({ childId: entry.id, parentId, reason: 'self' });
      continue;
    }
    pending.set(entry.id, parentId);
  }

  let registered = 0;
  const tryRegister = (childId: string, parentId: string): void => {
    if (wouldCreateLineageCycle(childId, parentId)) {
      dropped.push({ childId, parentId, reason: 'cycle' });
      return;
    }
    if (getLineageDepth(parentId) + 1 > MAX_LINEAGE_HOPS) {
      dropped.push({ childId, parentId, reason: 'too-deep' });
      return;
    }
    registerSessionLineage(childId, parentId);
    registered += 1;
  };

  // 第 2 步：多轮稳定插入（父在子先；对入参顺序不敏感）
  let progressed = true;
  while (progressed && pending.size > 0) {
    progressed = false;
    for (const [childId, parentId] of [...pending]) {
      if (parentBySession.has(parentId) || !pending.has(parentId)) {
        tryRegister(childId, parentId);
        pending.delete(childId);
        progressed = true;
      }
    }
  }

  // 第 4 步：末轮（仅环会落到这里；按插入顺序，结果确定）
  for (const [childId, parentId] of pending) {
    tryRegister(childId, parentId);
  }

  return {
    scanned: entries.length,
    registered,
    dropped,
    size: parentBySession.size,
  };
}
