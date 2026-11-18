// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 审批批量合并（P3，2026-11-17）—— 同一轮里"同工具 + 同风险"的多次 ask 共用一张卡。
 *
 * 背景（真机会话 `session_mwk2fakzf30b34b448`）：多工具轮次内同类 ask 各自成卡
 * （19 张里 5 张同属一轮），用户要连点多次。
 *
 * ## 设计边界（刻意保守）
 * - **仅同工具 + 同风险**才合并（`bash` 与 `file_write` 绝不混在一张卡）；
 * - `workspace-scope`（工作区访问申请）走独立副作用，不参与合并；
 * - 每张卡最多挂 `APPROVAL_BATCH_MAX` 条（超出继续新建卡，避免"一张卡批 50 条"）；
 * - **合并窗口 `APPROVAL_BATCH_TTL_MS`（120s）**：卡片创建超时后不再接收新条目
 *   （B8，2026-11-18；避免"离开回来一次点击批量放行早已过时的调用"）；
 * - **同轮次限定（B8，2026-11-18）**：仅当候选卡与本条 ask 属于**同一工具轮次**
 *   （会话 `metadata.roundCounter`，随卡落 `metadata.roundId`）才合并；任一侧轮次
 *   不可得 ⇒ 不合并（无法证明同轮 ⇒ fail-closed）—— 防"上一轮遗留的卡被本轮一次点击顺带放行"；
 * - 合并簿在**内存**（`Map<inboxItemId, {entries, createdAt}>`）：进程重启即丢，丢批不会误放行
 *   —— 对应调用仍是 awaiting，用户重新批准即可（fail-closed）；
 * - 总闸 `PERMISSION_APPROVAL_BATCH=true` **默认关**（权限域环境变量；只认显式 true）；
 *   关 ⇒ 与改造前逐字一致。
 *
 * 回填：`inboxApproval.applyApprovalSideEffects` 在批准主条目后 `drainApprovalBatch()`
 * 逐个写 `ApprovedCommandRegistry`（作用域档沿用主条目的 `scopeKind`）。
 */

/** 单卡最多合并的条目数（主条目之外） */
export const APPROVAL_BATCH_MAX = 5;

/** 合并窗口（B8：卡片创建超过该时长后不再接收新条目；120s） */
export const APPROVAL_BATCH_TTL_MS = 120_000;

/** 一条被合并的待批准调用 */
export interface ApprovalBatchEntry {
  /** 提交端算好的命令 hash（与 `ApprovedCommandRegistry.approve` 同口径） */
  commandHash: string;
  /** 命令原文（写入 `baseCommand` / `commandSignature` 用；缺省 ⇒ 只按精确 hash 命中） */
  command?: string;
  /** 工具声明的参数指纹（排障用，不参与放行判定） */
  fingerprintHash?: string;
}

/** 合并簿：inboxItemId ⇒ 被合并的调用列表 + 窗口起点（主条目不在此表内） */
const batches = new Map<
  string,
  { entries: ApprovalBatchEntry[]; createdAt: number }
>();

/**
 * 是否允许把本次 ask 合并进既有待审批卡（**纯函数**，便于单测）。
 *
 * B8（2026-11-18）：除"同工具 + 同风险"外，卡片创建超过 {@link APPROVAL_BATCH_TTL_MS}
 * ⇒ 不再合并（避免用户离开后回来，一次点击批量放行早已过时的调用）。
 *
 * B8 同轮次限定：候选卡的 `roundId` 必须与本条 ask 的 `roundId` **相等且都存在**；
 * 任一侧缺失（旧卡 / 未接入轮次标识的路径）⇒ 不合并。
 */
export function canBatchApproval(params: {
  /** 总闸 `FEATURE_APPROVAL_BATCH` */
  enabled: boolean;
  /** 候选卡已合并的条目数 */
  pendingCount: number;
  /** 候选卡的工具名 / 风险级（来自其 metadata） */
  candidateToolName?: unknown;
  candidateRisk?: unknown;
  /** 候选卡的轮次标识（`metadata.roundId`） */
  candidateRoundId?: unknown;
  /** 候选卡是否工作区访问申请（独立副作用 ⇒ 不合并） */
  candidateIsWorkspaceScope?: boolean;
  /** 候选卡创建时刻（ms）；提供时按 TTL 判定 */
  candidateCreatedAt?: number;
  /** 当前时刻（ms，便于测试注入） */
  now?: number;
  /** 本次调用的工具名 / 风险级 / 轮次标识 */
  toolName: string;
  risk: string;
  roundId?: number;
}): boolean {
  if (!params.enabled) return false;
  if (params.candidateIsWorkspaceScope === true) return false;
  if (params.pendingCount >= APPROVAL_BATCH_MAX) return false;
  if (typeof params.candidateCreatedAt === 'number') {
    const now = params.now ?? Date.now();
    if (now - params.candidateCreatedAt > APPROVAL_BATCH_TTL_MS) return false;
  }
  // B8：同轮次限定 —— 两侧都必须有轮次标识且相等
  if (
    typeof params.roundId !== 'number' ||
    typeof params.candidateRoundId !== 'number' ||
    params.candidateRoundId !== params.roundId
  ) {
    return false;
  }
  return (
    params.candidateToolName === params.toolName &&
    params.candidateRisk === params.risk
  );
}

/** 追加一条合并条目；超过上限 / 窗口过期 ⇒ `false`（调用方改为新建卡） */
export function addApprovalBatchEntry(
  inboxItemId: string,
  entry: ApprovalBatchEntry,
  now: number = Date.now()
): boolean {
  if (!inboxItemId || !entry.commandHash) return false;
  const current = batches.get(inboxItemId);
  // 窗口过期（或首条）⇒ 重新起窗，不带旧条目
  const bucket =
    current && now - current.createdAt <= APPROVAL_BATCH_TTL_MS
      ? current
      : { entries: [], createdAt: now };
  if (bucket.entries.length >= APPROVAL_BATCH_MAX) return false;
  bucket.entries.push(entry);
  batches.set(inboxItemId, bucket);
  return true;
}

/** 已合并条目数（用于上限判定） */
export function getApprovalBatchSize(inboxItemId: string): number {
  return batches.get(inboxItemId)?.entries.length ?? 0;
}

/** 取走并清空某张卡的合并条目（批准/拒绝/过期后调用；幂等） */
export function drainApprovalBatch(inboxItemId: string): ApprovalBatchEntry[] {
  const bucket = batches.get(inboxItemId);
  if (!bucket) return [];
  batches.delete(inboxItemId);
  return bucket.entries;
}

/** 清空全部合并簿（会话拆除 / 测试隔离用） */
export function clearApprovalBatches(): void {
  batches.clear();
}
