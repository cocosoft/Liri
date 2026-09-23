// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 预存债务修复（2026-09-23，FSZ-162）：从 `UnifiedTokenTracker` 抽出「校准」一块。
 *
 * **为什么抽**：原 `UnifiedTokenTracker.ts` 834 行（`lint:size` >800 = 错误）。按
 * `scripts/layer-exceptions.json#FSZ-162` 的既定计划，把校准（EMA 因子 + 样本计数 +
 * 持久化）与统计（`getCalibrationStats`）移出，宿主文件回归阈值内。
 *
 * **边界（刻意保守）**：**状态仍由宿主持有**（`CalibrationState`），本模块只放**纯逻辑**
 * —— 因为 `calibrationFactor` 在宿主还有 4 处外部触点（模型切换恢复 `:714`、会话元数据
 * 恢复、状态快照、`streamState` 初值），把状态也搬走会连带改动那些触点与它们的不变量。
 * 逻辑逐字迁移 ⇒ 行为不变（由 `tests/core/tokenBudget/calibrationSource.test.ts` 锁定）。
 *
 * **D1 铁律（不变）**：缺 usage / 缺基线一律**保持既有因子**并计数，**不用估算或默认值冒充**。
 */
import { getLogger } from '../../monitoring/logs/Logger';
import { persistCalibrationFactor } from './CalibrationStore';

const logger = getLogger('tokenBudget:calibration');

/** EMA 平滑因子：新样本权重 30%（原为 `UnifiedTokenTracker.CALIBRATION_ALPHA`） */
const CALIBRATION_ALPHA = 0.3;

/** 校准状态（由宿主持有；本模块只读写它，不拥有生命周期） */
export interface CalibrationState {
  /** 当前校准因子（1.0 = 未校准；估算值 × 因子 ≈ 真实值） */
  factor: number;
  /** D1 可观测计数：已应用的真实 usage 样本数（每次成功更新因子 +1） */
  applied: number;
  /** D1 可观测计数：喂入样本**无有效 usage**（缺字段 / 全 0 / 格式未知）⇒ 不校准 */
  missingUsage: number;
  /** D1 可观测计数：有真实 usage 但无估算基线（或修正后输入 ≤ 0）⇒ 不校准 */
  missingBaseline: number;
}

/** 初值（与原字段初始化一致：factor=1.0、三个计数为 0） */
export function createCalibrationState(): CalibrationState {
  return { factor: 1.0, applied: 0, missingUsage: 0, missingBaseline: 0 };
}

/**
 * 校准所需的最小宿主能力（窄接口 ⇒ 便于单测与拆分；宿主用 4 个闭包实现）。
 */
export interface CalibrationHost {
  /** 记账真实用量（**无论能否校准都记**） */
  recordUsage(inputTokens: number, outputTokens: number): void;
  /** 当前估算基线（无基线 ⇒ ≤0） */
  baselineInputTokens(): number;
  /** 固定 overhead（系统提示 + 工具定义） */
  overheadTokens(): number;
  /** 最近活跃模型（用于按模型持久化校准因子） */
  currentModel(): string;
}

/** D1 可观测计数快照（诊断/单测） */
export function calibrationStats(state: CalibrationState): {
  applied: number;
  missingUsage: number;
  missingBaseline: number;
  factor: number;
} {
  return {
    applied: state.applied,
    missingUsage: state.missingUsage,
    missingBaseline: state.missingBaseline,
    factor: state.factor,
  };
}

/**
 * D1：校准的唯一实现（`recordTimingUsage` / `recordPostRequest` 两条入口共用）。
 *
 * 因子更新 = EMA（`CALIBRATION_ALPHA=0.3`）平滑 `真实 input / 估算 baseline`，
 * 并扣掉固定 overhead（系统提示 + 工具定义）。任一步拿不到真实数据 ⇒
 * **保持既有因子 + 计数**（不估算、不落默认值）。
 */
export function applyUsageSample(
  state: CalibrationState,
  host: CalibrationHost,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  model?: string
): void {
  const input =
    typeof inputTokens === 'number' && Number.isFinite(inputTokens)
      ? inputTokens
      : 0;
  const output =
    typeof outputTokens === 'number' && Number.isFinite(outputTokens)
      ? outputTokens
      : 0;
  if (input <= 0 && output <= 0) {
    state.missingUsage++;
    logger.debug('unified:usage 样本缺失（不校准，保持既有因子）', {
      missingUsage: state.missingUsage,
    });
    return;
  }
  // 记账（无论能否校准都记真实用量）
  host.recordUsage(input, output);

  const overhead = host.overheadTokens();
  const baseline = host.baselineInputTokens();
  const correctedInput = input - overhead;
  if (baseline <= 0 || correctedInput <= 0) {
    state.missingBaseline++;
    logger.debug('unified:无估算基线，无法校准（保持既有因子）', {
      inputTokens: input,
      baselineInputTokens: baseline,
      correctedInput,
      missingBaseline: state.missingBaseline,
    });
    return;
  }
  const raw = correctedInput / baseline;
  if (!isFinite(raw) || raw <= 0) {
    state.missingBaseline++;
    return;
  }
  const oldFactor = state.factor;
  state.factor =
    CALIBRATION_ALPHA * raw + (1 - CALIBRATION_ALPHA) * state.factor;
  state.applied++;
  // 持久化校准因子（按模型，重启后直接恢复，无需重新学习）
  persistCalibrationFactor(model || host.currentModel(), state.factor);
  logger.info('unified:calibration updated', {
    source: 'metric/timing',
    oldFactor: Math.round(oldFactor * 100) / 100,
    newFactor: Math.round(state.factor * 100) / 100,
    raw,
    inputTokens: input,
    outputTokens: output,
    baselineInputTokens: baseline,
    appliedSamples: state.applied,
    model: model || host.currentModel(),
  });
}
