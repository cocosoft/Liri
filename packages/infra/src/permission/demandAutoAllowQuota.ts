/**
 * 许愿式（demand）自动放行的**配额与摘要**（2026-11-17，B3 余项）。
 *
 * 背景：P0 把「非危险但需审批」的命令降级为自动放行，B3 又补了硬拒词表与 killswitch。
 * 还剩两个口子（`工具审批治理-实施方案` §5-1）：
 *  ① **没有上限**：runaway 循环或提示注入可在一次会话里无限次自动放行；
 *  ② **没有摘要**：用户事后只能翻逐条 `permission:demand_auto_allow` 日志。
 *
 * 两件事：
 * - `consumeDemandAutoAllow`：按**会话**计数；配了上限且用尽 ⇒ 返回 `allowed:false`
 *   （调用方回落到 ask，不 deny、不改变非 demand 会话）；
 * - 每累计 {@link DEMAND_AUTO_ALLOW_SUMMARY_STEP} 次自动放行落一条结构化摘要
 *   （按工具计数），配额命中时另落一条**一次性**告警（同会话不重复刷）。
 *
 * 默认值：上限 **0 = 不限**（默认行为逐字不变）。开启方式（优先级从高到低）：
 * - 环境变量 `<prefix>DEMAND_AUTO_ALLOW_MAX=<N>`（运维 / CI 用）；
 * - 配置 `permission.demandAutoAllowMaxPerSession=<N>`（`config.json`，设置页未来可接）。
 *
 * 已知边界（如实标注）：计数只在**进程内**，重启归零；会话 id 缺失（后台 / 无人值守）
 * 时不计数也不限流 —— 那些路径本就不走 demand 降级。
 */

import { configManager } from '@openliri/infra/config';
import { getLogger } from '@openliri/infra/monitoring';
import { productEnvKey } from '@openliri/kernel';

const logger = getLogger('permission:demandAutoAllowQuota');

/** 配置键（`config.json#permission.demandAutoAllowMaxPerSession`） */
export const DEMAND_AUTO_ALLOW_MAX_KEY =
  'permission.demandAutoAllowMaxPerSession';

/** 环境变量（`<prefix>DEMAND_AUTO_ALLOW_MAX`）；显式 `0` 表示不限 */
export const ENV_DEMAND_AUTO_ALLOW_MAX = productEnvKey('DEMAND_AUTO_ALLOW_MAX');

/** 默认上限：0 = 不限（默认行为不变；需要护栏时显式配置） */
export const DEFAULT_DEMAND_AUTO_ALLOW_MAX = 0;

/** 上限的最大值（防误配成天文数字后彻底失去护栏意义） */
export const MAX_DEMAND_AUTO_ALLOW_QUOTA = 10000;

/** 每累计多少次自动放行落一条摘要 */
export const DEMAND_AUTO_ALLOW_SUMMARY_STEP = 50;

/** 跟踪的会话上限（超限按插入顺序淘汰最早的那个，防长驻进程内存增长） */
const MAX_TRACKED_SESSIONS = 200;

interface SessionQuotaState {
  count: number;
  byTool: Map<string, number>;
  /** 配额命中告警是否已落（同会话只落一次，避免每帧刷日志） */
  quotaHitLogged: boolean;
}

const sessions = new Map<string, SessionQuotaState>();

/** 纯函数：把配置/环境里的原始值解析成上限（非法 / 负数 / 非整数 ⇒ 0；超上限 ⇒ 夹到上限） */
export function resolveDemandAutoAllowMax(raw: unknown): number {
  const value =
    typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const rounded = Math.floor(value);
  if (rounded <= 0) return 0;
  return Math.min(rounded, MAX_DEMAND_AUTO_ALLOW_QUOTA);
}

/**
 * 当前生效的上限（环境变量 > 配置 > 0）。
 *
 * 环境变量优先是为了运维/CI 能不改配置文件就收紧；两者都缺省 ⇒ 不限。
 */
export function readDemandAutoAllowMax(
  env: NodeJS.ProcessEnv = process.env
): number {
  const fromEnv = env[ENV_DEMAND_AUTO_ALLOW_MAX];
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
    return resolveDemandAutoAllowMax(fromEnv);
  }
  return resolveDemandAutoAllowMax(
    configManager.getConfigValue<unknown>(DEMAND_AUTO_ALLOW_MAX_KEY)
  );
}

export interface DemandAutoAllowConsumeResult {
  /** `false` ⇒ 配额用尽，调用方应回落到 ask */
  allowed: boolean;
  /** 本会话已自动放行次数（`allowed:false` 时是**已用满**的次数） */
  count: number;
  /** 生效上限（0 = 不限） */
  limit: number;
}

/** 取/建会话状态；超过跟踪上限时淘汰最早插入的会话（Map 保插入序） */
function stateOf(sessionId: string): SessionQuotaState {
  const existing = sessions.get(sessionId);
  if (existing) return existing;
  if (sessions.size >= MAX_TRACKED_SESSIONS) {
    const oldest = sessions.keys().next();
    if (!oldest.done) sessions.delete(oldest.value);
  }
  const created: SessionQuotaState = {
    count: 0,
    byTool: new Map<string, number>(),
    quotaHitLogged: false,
  };
  sessions.set(sessionId, created);
  return created;
}

/** `byTool` → 普通对象（日志载荷用；只保留计数 > 0 的项） */
function byToolSnapshot(state: SessionQuotaState): Record<string, number> {
  return Object.fromEntries(state.byTool);
}

/**
 * 消费一次自动放行额度。
 *
 * @param input.sessionId 会话 id（缺失 ⇒ 不计数、不限流，返回 `allowed:true`）
 * @param input.toolName 工具名（摘要按它分组）
 * @param input.limit 显式上限（测试注入用；缺省读 {@link readDemandAutoAllowMax}）
 */
export function consumeDemandAutoAllow(input: {
  sessionId?: string | null;
  toolName: string;
  limit?: number;
}): DemandAutoAllowConsumeResult {
  const limit = input.limit ?? readDemandAutoAllowMax();
  if (!input.sessionId) return { allowed: true, count: 0, limit };

  const state = stateOf(input.sessionId);
  if (limit > 0 && state.count >= limit) {
    if (!state.quotaHitLogged) {
      state.quotaHitLogged = true;
      logger.warn('permission:demand_auto_allow_quota_hit', {
        sessionId: input.sessionId,
        limit,
        count: state.count,
        byTool: byToolSnapshot(state),
        configKey: DEMAND_AUTO_ALLOW_MAX_KEY,
        envKey: ENV_DEMAND_AUTO_ALLOW_MAX,
      });
    }
    return { allowed: false, count: state.count, limit };
  }

  state.count += 1;
  state.byTool.set(input.toolName, (state.byTool.get(input.toolName) ?? 0) + 1);
  if (state.count % DEMAND_AUTO_ALLOW_SUMMARY_STEP === 0) {
    logger.info('permission:demand_auto_allow_summary', {
      sessionId: input.sessionId,
      count: state.count,
      limit,
      byTool: byToolSnapshot(state),
    });
  }
  return { allowed: true, count: state.count, limit };
}

/** 只读快照（诊断 / 测试用；不改变计数） */
export function getDemandAutoAllowStats(sessionId: string): {
  count: number;
  byTool: Record<string, number>;
} {
  const state = sessions.get(sessionId);
  if (!state) return { count: 0, byTool: {} };
  return { count: state.count, byTool: byToolSnapshot(state) };
}

/** 清空计数（测试用；生产路径不需要重置 —— 进程重启即清零） */
export function resetDemandAutoAllowQuota(): void {
  sessions.clear();
}
