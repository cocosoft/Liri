/**
 * Budget Lease · **判定内核**（P5-6，2026-10-28）
 *
 * 规格：`.trae/specs/p5-runtime-hardening-specs.md` §2。
 *
 * ## 现状与要补的缺口
 * 现有 `tokenBudget` 是**计量**（`ContextStatsCollector` 统计用量），没有"配额让渡/回收"：
 * 一次 execution 拿到多少额度、什么时候到期、超额时是等还是拒，都没有判定。
 *
 * ## 租约 = 一次 execution 在**有限期限**内占用的一段预算
 * 三条规则（对应规格 B1/B2/B3）：
 * ① **不超额授予**：`Σ 未结算租约.amount + 新租约.amount ≤ 会话上限`，否则拒绝授予；
 * ② **一对一**：同一 `executionId` 不得同时持有两个未结算租约；
 * ③ **到期回收 / 用尽拒下一回合**：`expiresAt` 到期即不再计入占用；租约耗尽时只拒绝
 *    **下一次模型回合**（`shouldRejectNextTurn`），**不**中断在途工具调用。
 *
 * 期限口径取**墙钟**（规格 §2.4 第 2 问的建议）：回合内长任务不应被回合边界截断。
 * 预算单位取**会话级 token 汇总**（`cap` 由调用方按会话预算传入，本模块不猜单位）；
 * `cap` 的来源判定收口在 {@link resolveLeaseCap}。
 *
 * ## 接线状态（2026-10-28，如实）
 * **纯函数、尚无运行时消费者**。规格 §2 原计划"`ExecutionManager.acquire()` 之后授予 +
 * 回合前 `shouldRejectNextTurn`"，实测两条阻塞（取证见方案附录 D.6）：
 * ① `acquire()` 的两个调用点都被 `feature('CLIENT_STREAM_EXECUTION')` 默认关门控
 *   （`chat-handlers.ts` / `messageRouter.ts`）⇒ 接线点当前**不可达**；
 * ② `acquire()` 对同一 session 原子唯一（只允许一个 `RUNNING`）⇒ **会话粒度**租约退化成
 *   "整会话预算一条租约"，与既有 `TokenBudgetController.checkBudget() === EXCEEDED` +
 *   `token_budget_guard` 停止钩子**语义重复**，且 `ExecutionManager` 拿不到 `tokenBudget`
 *   （在 `ChatManager` 内）⇒ 需额外注入探针，收益不抵成本。
 * ⇒ 真正有价值的粒度是**并发子执行**（subagent 让渡），等该能力落地再接。
 */

/** 一段预算租约（不可变记录；每次变更新对象，便于作为纯函数输入） */
export interface BudgetLease {
  leaseId: string;
  executionId: string;
  /** 预算归属会话（"拒下一回合"按会话来判） */
  sessionId: string;
  /** 授予额度（token 数） */
  amount: number;
  /** 已用（结算时回写） */
  used: number;
  /** 到期时刻（epoch ms）；`<= now` 即视作已回收 */
  expiresAt: number;
}

export interface LeaseSummary {
  /** 仍被占用的额度（只计**活跃**租约的 `amount`） */
  committed: number;
  activeLeases: number;
  expiredLeases: number;
}

export type GrantLeaseResult =
  | { ok: true; lease: BudgetLease }
  | { ok: false; reason: string };

export interface GrantLeaseInput {
  leases: readonly BudgetLease[];
  leaseId: string;
  executionId: string;
  sessionId: string;
  amount: number;
  /** 会话预算上限（token） */
  cap: number;
  /** 租约时长（墙钟毫秒） */
  ttlMs: number;
  now: number;
}

/** 租约是否仍然有效（**到期即视为回收**：`expiresAt <= now` ⇒ 失效） */
export function isLeaseActive(lease: BudgetLease, now: number): boolean {
  return lease.expiresAt > now;
}

/** 汇总当前占用（只计活跃租约） */
export function summarizeLeases(
  leases: readonly BudgetLease[],
  now: number
): LeaseSummary {
  let committed = 0;
  let activeLeases = 0;
  let expiredLeases = 0;
  for (const lease of leases) {
    if (isLeaseActive(lease, now)) {
      committed += lease.amount;
      activeLeases += 1;
    } else {
      expiredLeases += 1;
    }
  }
  return { committed, activeLeases, expiredLeases };
}

/** 某 execution 是否已持有未结算租约（规则②：一对一） */
export function findActiveLeaseOfExecution(
  leases: readonly BudgetLease[],
  executionId: string,
  now: number
): BudgetLease | undefined {
  return leases.find(
    (lease) => lease.executionId === executionId && isLeaseActive(lease, now)
  );
}

/** 授予租约（规则①②；任何前置不满足 ⇒ 拒绝，不静默降额） */
export function grantLease(input: GrantLeaseInput): GrantLeaseResult {
  const { leases, amount, cap, ttlMs, now } = input;
  if (!(amount > 0)) {
    return { ok: false, reason: '授予额度必须为正数' };
  }
  if (!(cap > 0)) {
    return { ok: false, reason: '未配置会话预算上限（cap）⇒ 不授予' };
  }
  if (!(ttlMs > 0)) {
    return { ok: false, reason: '租约时长必须为正数（墙钟毫秒）' };
  }
  if (findActiveLeaseOfExecution(leases, input.executionId, now)) {
    return {
      ok: false,
      reason: `同一 execution（${input.executionId}）已持有未结算租约（一对一）`,
    };
  }
  const { committed } = summarizeLeases(leases, now);
  if (committed + amount > cap) {
    return {
      ok: false,
      reason: `超额授予：已占用 ${committed} + 本次 ${amount} > 上限 ${cap}`,
    };
  }
  return {
    ok: true,
    lease: {
      leaseId: input.leaseId,
      executionId: input.executionId,
      sessionId: input.sessionId,
      amount,
      used: 0,
      expiresAt: now + ttlMs,
    },
  };
}

/**
 * 结算租约：回写 `used`，并**立即回收剩余额度**（`expiresAt = now`）。
 *
 * 结算后的租约不再计入占用 ⇒ 同一 execution 可再次申请（新租约）。
 */
export function settleLease(
  lease: BudgetLease,
  used: number,
  now: number
): BudgetLease {
  const clampedUsed = Math.max(0, Math.min(used, lease.amount));
  return { ...lease, used: clampedUsed, expiresAt: now };
}

/** 租约是否已耗尽（`used >= amount`） */
export function isLeaseExhausted(lease: BudgetLease): boolean {
  return lease.used >= lease.amount;
}

/**
 * **cap 的来源判定**（规格 §2.4 第 3 问，2026-10-28 定）。
 *
 * 优先级：① 配置显式值（`config.json → executionBudgetLease.cap > 0`）；
 * ② **会话级 `tokenBudget` 汇总**（`TokenBudgetController.getBudgetParams().total`）。
 *
 * 为什么以会话预算为默认：`max_tokens` 是**单次请求**配置，表达不了"这个会话总共能花多少"；
 * 而 `tokenBudget` 的 `total` 正是该会话当前模型的上下文预算（流式路径 `createStreamBudget`）。
 *
 * 两者都不可用（<=0 / 非有限数）⇒ 返回 `0` ⇒ `grantLease` 直接拒绝授予
 * （fail-closed：不猜额度、不静默超额）。
 */
export function resolveLeaseCap(
  configCap: number,
  sessionBudgetTotal: number
): number {
  if (Number.isFinite(configCap) && configCap > 0) return configCap;
  if (Number.isFinite(sessionBudgetTotal) && sessionBudgetTotal > 0) {
    return sessionBudgetTotal;
  }
  return 0;
}

/**
 * 是否应**拒绝该会话的下一次模型回合**（规则③）。
 *
 * 只拒"下一回合"：在途工具调用不被打断（避免把已发出的副作用拦腰截断）。
 */
export function shouldRejectNextTurn(
  leases: readonly BudgetLease[],
  sessionId: string,
  now: number
): boolean {
  return leases.some(
    (lease) =>
      lease.sessionId === sessionId &&
      isLeaseActive(lease, now) &&
      isLeaseExhausted(lease)
  );
}
