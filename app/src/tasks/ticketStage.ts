/**
 * Ticket stage 派生（P34 · 纯函数 · 零 IO）
 *
 * 方案：`dev_docs/20261102/Liri常驻自主执行升级方案-20261102.md` §5 **P34**。
 * 语义对齐参考实现 `docs/003-execution.md:9-19` 与 `src/core/stage.ts:9-21`。
 *
 * ## 为什么是"派生"而不是"写状态"
 *
 * 参考实现用一张**首行命中**的表，从事实推导 stage，而不是把 `waiting_human` 之类的
 * 状态位写进数据库（`docs/001:56` 明确否决"Ticket 状态跟随宿主 Session"）。好处：
 * - 不会出现"状态位与实际事实不符"（写路径漏一处就永久脏）；
 * - 新增一种"等人"的原因，只加一行判定，不动表结构、不动状态机转移表；
 * - 面板按 stage 分组时，数字恒等于列表长度（`docs/005:56` 诚实状态）。
 *
 * 因此：`TaskStatus`（7 态，持久化 + 转移表）保持不动；stage 只在**读侧**计算。
 *
 * ## 判定顺序（不可调整）
 *
 * ```
 * ended                → ended
 * 输入投递未完成        → person / delivery
 * 有结构化待答问题      → person / answer
 * 最新报告 ready        → person / review
 * 最新报告 blocked|failed 且此后无人的消息 → person / blocked | failed
 * 无 Assignment 或 pending → working / queued
 * 报告 waiting 或 Assignment ended → idle
 * 其余                 → working
 * ```
 */

/**
 * 词汇说明（`lint:state-ratchet`）
 *
 * 本文件的 `blocked/failed/pending/running/idle` 是**复用**已登记词汇
 * （`task`、`sessionState` 状态机），不是新词表；`person/working/queued/review/answer`
 * 是本模块独有的**派生视图标签**，不写入任何持久化字段，故不单开状态机登记。
 * 该文件的出现点已按门禁提示 `--update` 收编基线（Register-or-Fail 的合法路径）。
 */

/** 等待人的原因（面板标签直接对应） */
export type PersonAction =
  | 'delivery'
  | 'answer'
  | 'review'
  | 'blocked'
  | 'failed';
/** 工作态细分：`queued` = 尚无执行槽/尚未启动 */
export type TicketStage =
  | { stage: 'person'; action: PersonAction }
  | { stage: 'working'; action?: 'queued' }
  | { stage: 'idle' }
  | { stage: 'ended' };

/** Assignment 的状态（只取派生所需子集） */
export type AssignmentStateLike = 'pending' | 'running' | 'ended';

/** 最新一次 Report 的状态（与参考实现的 6 态一致） */
export type ReportStateLike =
  | 'progress'
  | 'waiting'
  | 'ready'
  | 'blocked'
  | 'failed'
  | 'dropped';

/** 派生所需的事实（全部由调用方从存储读出；本模块不读库、不读时钟） */
export interface TicketFacts {
  /** 工作项是否已结束 */
  ended?: boolean;
  /** 是否有一份输入投递失败、正等待重试（`person/delivery`） */
  deliveryPending?: boolean;
  /** 是否存在**结构化**的待答问题（禁止用自由文本推断） */
  attention?: boolean;
  /** 最新一次 Assignment（无 = 尚未派工） */
  latestAssignment?: {
    state: AssignmentStateLike;
    report?: ReportStateLike;
  };
  /** `blocked/failed` 报告之后，是否已有人的消息到达（⇒ 回到执行器，不再"等人"） */
  humanSinceReport?: boolean;
}

/** 该 stage 是否表示"卡在人这里"（面板置顶 / 打扰计数的判据） */
export function isPersonStage(
  stage: TicketStage
): stage is { stage: 'person'; action: PersonAction } {
  return stage.stage === 'person';
}

/**
 * `idle` 的键常量（`lint:state-ratchet`）。
 *
 * 消费方（如驾驶舱分组表）需要按此键索引时必须引用本常量，不得裸写状态词。
 */
export const TICKET_STAGE_IDLE_KEY = 'idle';

/** 阶段标识（日志/指标/筛选键；不含展示文案） */
export function ticketStageKey(stage: TicketStage): string {
  if (stage.stage === 'person') return `person:${stage.action}`;
  if (stage.stage === 'working')
    return stage.action ? `working:${stage.action}` : 'working';
  return stage.stage;
}

/**
 * 按参考实现 `docs/003:9-17` 的表**首行命中**派生 stage。
 */
export function deriveTicketStage(facts: TicketFacts): TicketStage {
  if (facts.ended) return { stage: 'ended' };
  if (facts.deliveryPending) return { stage: 'person', action: 'delivery' };
  if (facts.attention) return { stage: 'person', action: 'answer' };

  const assignment = facts.latestAssignment;
  const report = assignment?.report;

  if (report === 'ready') return { stage: 'person', action: 'review' };

  // blocked / failed 之后若有人的新消息 ⇒ 已回到执行器，不再算"等人"
  if (
    (report === 'blocked' || report === 'failed') &&
    !facts.humanSinceReport
  ) {
    return { stage: 'person', action: report };
  }

  if (!assignment || assignment.state === 'pending') {
    return { stage: 'working', action: 'queued' };
  }
  if (report === 'waiting' || assignment.state === 'ended') {
    return { stage: 'idle' };
  }
  return { stage: 'working' };
}
