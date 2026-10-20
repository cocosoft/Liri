/**
 * AlwaysOn 自主执行闭环 — 类型定义
 *
 * P0-2: 对标 PilotDeck AlwaysOnRuntime — 4阶段流水线 + 9门控
 */

/** 全局配置 */
export interface AlwaysOnConfig {
  tickIntervalMinutes: number;
  cooldownMinutes: number;
  dailyBudget: number;
  recentUserMsgMinutes: number;
  heartbeatStaleSeconds: number;
  dormantDebounceMs: number;
  execution: {
    maxTurns: number;
    maxToolCalls: number;
    timeoutMinutes: number;
    /** 目标达成自评的单次超时（毫秒）—— 独立于执行超时，避免自评拖住报告 */
    goalEvalTimeoutMs: number;
    /** 自评前向日预算预留的 token（保守估计；预算锁定 ⇒ 不评估） */
    goalEvalEstimatedTokens: number;
  };
}

export const DEFAULT_ALWAYSON_CONFIG: AlwaysOnConfig = {
  tickIntervalMinutes: 5,
  cooldownMinutes: 60,
  dailyBudget: 4,
  recentUserMsgMinutes: 5,
  heartbeatStaleSeconds: 90,
  dormantDebounceMs: 2000,
  execution: {
    maxTurns: 30,
    maxToolCalls: 200,
    timeoutMinutes: 20,
    goalEvalTimeoutMs: 120_000,
    goalEvalEstimatedTokens: 2_000,
  },
};

/** 9 种门控阻塞原因 */
export type GateReason =
  | 'disabled'
  | 'project_disabled'
  | 'project_missing'
  | 'dormant_no_signal'
  | 'agent_busy'
  | 'recent_user_msg'
  | 'cooldown'
  | 'daily_budget'
  | 'lock_busy';

/** 门控检查结果 */
export interface GateResult {
  passed: boolean;
  reason?: GateReason;
  detail?: string;
}

/** 4 阶段 */
export type PipelinePhase = 'discovery' | 'workspace' | 'execution' | 'report';

/** 发现阶段产出的执行计划 */
export interface DiscoveryPlan {
  id: string;
  summary: string;
  actions: Array<{
    type: string;
    description: string;
    params: Record<string, unknown>;
  }>;
  riskLevel: 'low' | 'medium' | 'high';
}

/** 执行结果 */
export interface ExecutionResult {
  success: boolean;
  output: string;
  errors: string[];
  toolCalls: number;
  durationMs: number;
}
