/**
 * 验证器「每会话最新结果」只读投影（D5，2026-11-18）
 *
 * **为什么在 infra**：写方在 `packages/query`（app 层），读方在
 * `app/src/infrastructure/http/handlers/routes`（service 层）——
 * 两侧都只允许依赖**下层**。放 infra 才能同时被写/读而不产生 `service → app` 反向依赖
 * （`lint:arch` R00-001 实测会拦）。
 *
 * 口径：
 * - **只转述**验证器产物（`verdict` / `confidence` / `checkPassRate`），不重算、不猜测；
 * - **有界**：`LRUCache(200)`（复用 `utils/cache`，CS01），长跑不增长；
 * - **进程内、无持久化**：重启后为空，调用方必须按「无信号」处理（不得回填）；
 * - 自身不驱动任何业务分支；消费方（A2A 不确定性）由开关 `A2A_UNCERTAINTY_VERIFIER` 默认关闭。
 */
import { LRUCache } from '../../utils/cache';

/** 每会话最新结果索引上限（LRU） */
const MAX_LATEST_SESSIONS = 200;

/** 某会话**最新一次**验证结果（只读投影；`confidence` 原样，不重算） */
export interface LatestVerifierResult {
  verdict: 'APPROVE' | 'REJECT' | 'ESCALATE';
  /** 验证器自评置信度 0..1（未提供 ⇒ 缺省） */
  confidence?: number;
  /** 检查项通过率 0..1（客观指标；未提供 ⇒ 缺省） */
  checkPassRate?: number;
  /** 该结果所属轮次 */
  turn: number;
  /** 记录时刻（epoch ms） */
  at: number;
}

const latestBySession = new LRUCache<LatestVerifierResult>(MAX_LATEST_SESSIONS);

/** 写入（覆盖同会话的旧值；超上限按 LRU 淘汰） */
export function recordLatestVerifierResult(
  sessionId: string,
  result: LatestVerifierResult
): void {
  latestBySession.set(sessionId, result);
}

/** 读取某会话最新结果；未记录过 ⇒ `null` */
export function getLatestVerifierResult(
  sessionId: string
): LatestVerifierResult | null {
  return latestBySession.get(sessionId) ?? null;
}

/** 重置（测试用；生产不调用） */
export function resetLatestVerifierResults(): void {
  latestBySession.clear();
}
