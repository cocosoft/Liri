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
import { getLogger } from '@openliri/kernel/loggerFacade.js';
import { persistCalibrationFactor } from './CalibrationStore';

const logger = getLogger('tokenBudget:calibration');

/** EMA 平滑因子：新样本权重 30%（原为 `UnifiedTokenTracker.CALIBRATION_ALPHA`） */
const CALIBRATION_ALPHA = 0.3;

/**
 * 单个样本的比值合理区间（2026-11-26，真机 `session_mwwb2nt8807735cdf4`）。
 *
 * 现场：内部小请求（如标题/记忆提炼）的估算基线只有 400–600 tokens，而 provider 实测
 * `inputTokens ≈ 18k`（系统提示 + 工具定义占绝对多数）⇒ raw ≈ 27–40，EMA 把因子从
 * 1.22 一路推到 22.5；此后 `calibratedTotal = (真实 ~13k + 输出预留) × 22 ≈ 230k`
 * ⇒ 压缩判定 ratio > 1 ⇒ 每轮 `trigger` 但 `applied:false`（空转）。
 *
 * 取值依据：真实样本见过 raw ≈ 4.09（基线 4075 / 实测 16660，见
 * `.trae/specs/trajectory-single-source-convergence.md` §真实对话实测）⇒ 区间上限取 10；
 * 污染样本是 25–40（基线 400–700 / 实测 ~18k），二者量级不重叠。
 * 超出区间说明"基线不代表本次输入"（样本不可用），按 D1「缺数据不猜」处理：
 * 只计数、不改因子。
 */
const MIN_PLAUSIBLE_RAW = 0.1;
const MAX_PLAUSIBLE_RAW = 10;

/**
 * 持久化因子的可用区间（2026-11-26）：恢复时越界 ⇒ 视为被污染的历史值，回落默认。
 * 与 raw 区间同源（因子是 raw 的 EMA，长期应落在同一量级）。
 */
const MIN_PLAUSIBLE_FACTOR = 0.25;
const MAX_PLAUSIBLE_FACTOR = 10;

/** 持久化因子是否可用（越界/非有限 ⇒ false；调用方回落默认 1.2） */
export function isPlausibleCalibrationFactor(factor: number): boolean {
  return (
    Number.isFinite(factor) &&
    factor >= MIN_PLAUSIBLE_FACTOR &&
    factor <= MAX_PLAUSIBLE_FACTOR
  );
}

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
  /** D1 可观测计数：比值越界（基线不代表性 / 模型映射错配）⇒ 不校准 */
  implausible: number;
}

/** 初值（与原字段初始化一致：factor=1.0、计数为 0） */
export function createCalibrationState(): CalibrationState {
  return {
    factor: 1.0,
    applied: 0,
    missingUsage: 0,
    missingBaseline: 0,
    implausible: 0,
  };
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
  implausible: number;
  factor: number;
} {
  return {
    applied: state.applied,
    missingUsage: state.missingUsage,
    missingBaseline: state.missingBaseline,
    implausible: state.implausible,
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
  // 2026-11-26：比值越界 ⇒ 样本不可用（基线不代表性 / 模型映射错配），只计数不改因子。
  if (raw < MIN_PLAUSIBLE_RAW || raw > MAX_PLAUSIBLE_RAW) {
    state.implausible++;
    logger.warn('unified:校准样本比值越界（不校准，保持既有因子）', {
      raw: Math.round(raw * 100) / 100,
      inputTokens: input,
      outputTokens: output,
      baselineInputTokens: baseline,
      overheadTokens: overhead,
      plausibleRange: [MIN_PLAUSIBLE_RAW, MAX_PLAUSIBLE_RAW],
      model: model || host.currentModel(),
      implausibleSamples: state.implausible,
    });
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
