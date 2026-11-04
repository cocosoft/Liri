// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * inboxApprovalDedupe — 审批卡**提交前去重**（PR-1，2026-10-23）
 *
 * 背景：`InboxManager.submit` 每次 `randomUUID()` 直接 INSERT，无 `(sessionId, 工具, 指纹)` 唯一约束
 * ⇒ 同一调用在"提交 → 批准 → 续跑重放"期间会累积多张 pending 卡（"僵尸审批卡"）。
 *
 * 口径：**只合并同一指纹**（工具 + 参数指纹的 hash），参数一变必须新建卡（安全优先）；
 * 只匹配 `status='pending'` 的 approval 项，已处理/过期的照常新建。
 *
 * 依赖形态：只要求 `list()`（结构性最小接口），避免 permission → runtime 的静态跨层。
 */

/** Inbox 列表项的最小形态（与 `InboxItem` 兼容） */
export interface MinimalInboxItem {
  id: string;
  status?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Inbox 查询器的最小形态（`InboxManager` 兼容）。
 *
 * 参数用 `Record<string, unknown>` 而非具体枚举：真实实现接受
 * `{sessionId?, status?: InboxItemStatus, type?: InboxItemType, limit?, offset?}`，
 * 方法参数双变（bivariant）⇒ 可直接传入，无需 permission → runtime 的类型依赖。
 */
export interface PendingApprovalLookup {
  list?(params?: Record<string, unknown>): Promise<{
    items: MinimalInboxItem[];
  }>;
  /**
   * P0-1（2026-11-04）：复用既有卡时给"合并次数" +1（`InboxManager.bumpApprovalHit`）。
   *
   * **可选**：无该方法的最小实现（仅 `list`）照常去重，只是不计数。
   * 计数**不另建一套去重**（`approval_dedup` 表未接线，避免双轨）——它只记录"被合并了几次"。
   */
  bumpApprovalHit?(id: string): Promise<boolean>;
}

/**
 * 查找同一会话下**同一工具 + 同一指纹**的待审批项。
 *
 * @returns 已存在的 Inbox 项 id；无匹配返回 undefined
 */
export async function findPendingApprovalId(
  lookup: PendingApprovalLookup,
  params: {
    sessionId: string;
    toolName: string;
    /** `hashCommandForExecution(toolCallApprovalKey(...))` 的结果 */
    approvalHash: string;
  }
): Promise<string | undefined> {
  try {
    if (typeof lookup.list !== 'function') return undefined;
    const { items } = await lookup.list({
      sessionId: params.sessionId,
      status: 'pending',
      type: 'approval',
      limit: 50,
    });
    for (const item of items) {
      if (item.status && item.status !== 'pending') continue;
      const meta = item.metadata;
      if (!meta) continue;
      if (
        meta.toolName === params.toolName &&
        meta.commandHash === params.approvalHash
      ) {
        // P0-1：命中也即"又请求了一次同一审批" ⇒ 计数 +1（失败不影响复用）
        if (typeof lookup.bumpApprovalHit === 'function') {
          await lookup.bumpApprovalHit(item.id);
        }
        return item.id;
      }
    }
  } catch {
    // @ignore-catch — 去重是优化项；查询失败照常新建卡片
  }
  return undefined;
}
