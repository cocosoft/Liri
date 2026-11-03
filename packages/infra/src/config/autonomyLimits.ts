/**
 * 自主执行（AlwaysOn）的运行预算（2026-11-03）
 *
 * **持久化**：`autonomy.limits`（`ConfigManager` 全局配置；`PUT /v1/config/autonomy.limits` 同源）。
 *
 * **为什么可调**：原先是 `DEFAULT_ALWAYSON_CONFIG` 里的硬编码（20 分钟 / 4 轮 / 60 分钟间隔），
 * 长程任务（如整关游戏开发）跑不到看得见的进度就被停 —— 用户实测"长程任务总是自动中断"。
 * 现改为**默认放宽 + 用户可调**，同时保留上限防止失控烧钱。
 *
 * **为什么放 infra/config**：entry 与 HTTP handler（service 层）都要读写它，
 * `service → app` 是反向依赖（`lint:arch` R00-001），只有 infra 两侧都能依赖。
 */
import { configManager } from './ConfigManager.js';

/** 配置键（`GET/PUT /v1/config/autonomy.limits`） */
export const AUTONOMY_LIMITS_CONFIG_KEY = 'autonomy.limits';

export interface AutonomyLimits {
  /** 单轮执行最长时长（分钟） */
  timeoutMinutes: number;
  /** 单轮工具调用上限 */
  maxToolCalls: number;
  /** 每项目每日自主运行轮次上限 */
  dailyBudget: number;
  /** 两次自主运行的最小间隔（分钟） */
  cooldownMinutes: number;
}

/**
 * 默认预算（2026-11-03 由 20/200/4/60 放宽）。
 *
 * 单轮 45 分钟 + 每日 8 轮 ≈ 每天最多 6 小时自主执行；仍在日预算（USD）与工具调用上限之内。
 */
export const DEFAULT_AUTONOMY_LIMITS: AutonomyLimits = {
  timeoutMinutes: 45,
  maxToolCalls: 400,
  dailyBudget: 8,
  cooldownMinutes: 30,
};

/** 每个字段的合法区间（越界回落到默认值，避免 0/负数把功能关死或放大到失控） */
const RANGES: Record<keyof AutonomyLimits, { min: number; max: number }> = {
  timeoutMinutes: { min: 1, max: 180 },
  maxToolCalls: { min: 10, max: 2000 },
  dailyBudget: { min: 1, max: 48 },
  cooldownMinutes: { min: 1, max: 1440 },
};

function sanitize(key: keyof AutonomyLimits, value: unknown): number {
  const fallback = DEFAULT_AUTONOMY_LIMITS[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  const range = RANGES[key];
  if (rounded < range.min || rounded > range.max) return fallback;
  return rounded;
}

/** 当前生效预算（缺失 / 脏值 ⇒ 默认值；逐字段兜底） */
export function readAutonomyLimits(): AutonomyLimits {
  const raw = configManager.getConfigValue(AUTONOMY_LIMITS_CONFIG_KEY) as
    | Partial<Record<keyof AutonomyLimits, unknown>>
    | undefined;
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    timeoutMinutes: sanitize('timeoutMinutes', src.timeoutMinutes),
    maxToolCalls: sanitize('maxToolCalls', src.maxToolCalls),
    dailyBudget: sanitize('dailyBudget', src.dailyBudget),
    cooldownMinutes: sanitize('cooldownMinutes', src.cooldownMinutes),
  };
}

/**
 * 写入预算（局部更新），返回写入后的**完整**预算。
 *
 * 运行期生效：handler 写完后广播 `config:changed` ⇒ `alwaysOnEntry` 按新预算重建调度。
 */
export function setAutonomyLimits(
  patch: Partial<Record<keyof AutonomyLimits, unknown>>
): AutonomyLimits {
  const current = readAutonomyLimits();
  const pick = (key: keyof AutonomyLimits): number =>
    sanitize(key, patch[key] ?? current[key]);
  const next: AutonomyLimits = {
    timeoutMinutes: pick('timeoutMinutes'),
    maxToolCalls: pick('maxToolCalls'),
    dailyBudget: pick('dailyBudget'),
    cooldownMinutes: pick('cooldownMinutes'),
  };
  configManager.setConfigValue(AUTONOMY_LIMITS_CONFIG_KEY, next);
  return next;
}
