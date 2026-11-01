/**
 * 审批四段 · **判定内核**（P5-5，2026-10-28）
 *
 * 规格：`.trae/specs/p5-runtime-hardening-specs.md` §1。
 *
 * ## 四段（缺一不算审批）
 * `requested`（申请）→ `presented`（呈现：参数摘要 + 风险 + 授权维度 + 可选动作）
 * → `decided`（决定：`allow_once` / `allow_session` / `allow_always` / `deny`）
 * → `recorded`（留痕：放行缓存键 + 范围 + 审计）。
 *
 * ## 本模块只做"顺序与前置条件"的判定
 * 它是**纯函数状态机**：**不**发事件、**不**碰 UI、**不**读写磁盘。理由：
 * 真正的四段横跨 `chat`（审批卡提交）→ Inbox → 用户作答 → 服务端，属于跨层接线；
 * 先把"什么顺序合法、哪些决定必须带授权维度"钉死，接线时不再改判据。
 *
 * ## 接线状态（2026-10-28 P5-1，如实）
 * - 本内核已被 `PermissionChecker._submitToInbox` / `ChatManager._submitToolApproval`
 *   （①②）与 `runtime/inboxApproval.recordApprovalDecision`（③④）**按段调用**；
 *   事件落盘在 `permission/approvalAudit` + `runtime/api/approvalAuditSink`。
 * - 开关：`config.json → approvalFourStage.enabled`，默认 `false`（关闭 ⇒ 零事件、行为零变更）。
 * - 仍未接：`by: 'timeout'` —— 既有 `PermissionChecker.timeoutToDeny` **零调用方**，
 *   真实的挂起超时走 Inbox 过期而非该函数；故超时决定当前**不产生** ③ 事件（方案附录 D.6）。
 *
 * ## 三条硬规则（对应规格 A2/A3/A4）
 * ① **不得跳段**：只能 `requested → presented → decided → recorded` 逐段推进；
 * ② **决定必须显式**：进入 `decided` 必须带 `decision`；`deny` 是终态（不得再 `recorded`）；
 * ③ **授权维度随决定**：`allow_session` / `allow_always` 必须带 `fingerprint`
 *   （否则"本会话/永久允许"会放大成全局）。
 */

/** 审批四段（顺序即数组顺序） */
export const APPROVAL_STAGES = [
  'requested',
  'presented',
  'decided',
  'recorded',
] as const;

export type ApprovalStage = (typeof APPROVAL_STAGES)[number];

/** 用户可选动作（与规格 §1.1 第③段一致） */
export type ApprovalDecisionValue =
  | 'allow_once'
  | 'allow_session'
  /**
   * 持久化放行（Inbox 的 `allowlist_call` / `allowlist_tool` / `allowlist_command`）。
   *
   * 规格 §1.1 原写三值，本值是**取证后的补充**：四档审批是既有一等能力
   * （`PermissionChecker._submitToInbox` 的 `options`），把"始终允许"记账成
   * `allow_session` 会让留痕与事实不符（会话结束不会失效）。同 `allow_session`，
   * 它也必须带授权维度 `fingerprint` —— 否则"持久放行"会被放大成全局。
   */
  | 'allow_always'
  | 'deny';

/** 审批链状态 */
export interface ApprovalChainState {
  stage: ApprovalStage;
  /** `decided` 起必填 */
  decision?: ApprovalDecisionValue;
  /** 授权维度（`allow_session` 必填；`allow_once` 可选，便于留痕） */
  fingerprint?: string;
}

export interface ApprovalAdvanceOptions {
  decision?: ApprovalDecisionValue;
  fingerprint?: string;
}

export type ApprovalAdvanceResult =
  | { ok: true; state: ApprovalChainState }
  | { ok: false; reason: string };

/** 起点：`requested`（申请已产生，尚未呈现） */
export function startApprovalChain(): ApprovalChainState {
  return { stage: 'requested' };
}

/**
 * 推进一步（**只允许相邻前进**；任何跳段 / 回退 / 重放一律拒绝）。
 *
 * @param state 当前状态
 * @param next 目标段
 * @param options `decided` 段必须给 `decision`
 */
export function advanceApproval(
  state: ApprovalChainState,
  next: ApprovalStage,
  options: ApprovalAdvanceOptions = {}
): ApprovalAdvanceResult {
  const from = APPROVAL_STAGES.indexOf(state.stage);
  const to = APPROVAL_STAGES.indexOf(next);
  if (to === -1) {
    return { ok: false, reason: `未知审批段：${String(next)}` };
  }
  if (to !== from + 1) {
    return {
      ok: false,
      reason: `审批段必须逐段前进：${state.stage} 不能直接到 ${next}`,
    };
  }
  if (state.stage === 'recorded') {
    return { ok: false, reason: '审批链已在 recorded 终态，不得继续推进' };
  }
  if (state.decision === 'deny') {
    return { ok: false, reason: '用户已拒绝（deny）⇒ 不得进入留痕/执行' };
  }
  if (next === 'decided') {
    if (!options.decision) {
      return {
        ok: false,
        reason: '进入 decided 必须带 decision（不得"默认允许"）',
      };
    }
    if (
      (options.decision === 'allow_session' ||
        options.decision === 'allow_always') &&
      !options.fingerprint
    ) {
      return {
        ok: false,
        reason: `${options.decision} 必须带 fingerprint（否则放行范围会被放大）`,
      };
    }
    return {
      ok: true,
      state: {
        stage: 'decided',
        decision: options.decision,
        ...(options.fingerprint ? { fingerprint: options.fingerprint } : {}),
      },
    };
  }
  if (next === 'recorded' && !state.decision) {
    return { ok: false, reason: '留痕前必须先有决定（decided）' };
  }
  return { ok: true, state: { ...state, stage: next } };
}

/** 该状态是否已可执行（只有 `decided: allow_*` 才放行；`deny` 与未决定都不行） */
export function isApprovalExecutable(state: ApprovalChainState): boolean {
  return (
    state.stage === 'decided' &&
    (state.decision === 'allow_once' ||
      state.decision === 'allow_session' ||
      state.decision === 'allow_always')
  );
}

/**
 * Inbox 回复值 → 四段决策（**单一映射**，2026-10-28）。
 *
 * 为什么放在判定内核：`inboxApproval.ts` 的 `APPROVAL_REPLIES` 与本映射描述的是
 * **同一套词表**（曾各写一遍 ⇒ 新增一档时会漂移）。现由本常量派生集合，
 * 审批事件（`approval/decided`）也用本映射 ⇒ 一处新增，两处同步。
 */
export const APPROVAL_REPLY_TO_DECISION = {
  approve: 'allow_once',
  approve_session: 'allow_session',
  allowlist_call: 'allow_always',
  allowlist_tool: 'allow_always',
  allowlist_command: 'allow_always',
} as const satisfies Record<string, ApprovalDecisionValue>;

/**
 * 解析一条审批回复的四段决策值。
 *
 * 语义与既有 `isApprovalReply` 一致（`reply` / `selectedOption` **任一命中**即算命中，
 * 命中优先级：持久化 > 本会话 > 本次）；都不命中 ⇒ `deny`（fail-closed）。
 */
export function resolveApprovalDecision(
  reply: string,
  selectedOption?: string
): ApprovalDecisionValue {
  const table: Record<string, ApprovalDecisionValue> =
    APPROVAL_REPLY_TO_DECISION;
  for (const candidate of [reply, selectedOption]) {
    if (candidate && Object.prototype.hasOwnProperty.call(table, candidate)) {
      return table[candidate];
    }
  }
  return 'deny';
}

/** 决策 → 留痕范围（`deny` 不落任何放行 ⇒ 记 `once`） */
export function resolveRecordScope(
  decision: ApprovalDecisionValue
): 'once' | 'session' | 'always' {
  if (decision === 'allow_session') return 'session';
  if (decision === 'allow_always') return 'always';
  return 'once';
}
