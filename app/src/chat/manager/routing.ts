// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * routing — 编排分流决策（issue #19 · Cut H，2026-10-29）
 *
 * 迁出来源：`ChatManager._shouldUsePlanDrivenLoop` / `_shouldUseCodeMode` /
 * `_hashMessage` / `_codeModeTrafficPercent`（合计约 45 行）。
 *
 * 三者都是**纯决策**（只读配置/feature/env，无会话状态）⇒ 外移为模块函数，
 * 装配侧直连（`facadeWiring` 的 `shouldUsePlanDrivenLoop` / `shouldUseCodeMode` 端口）。
 *
 * 行为不变：
 * - PlanDrivenLoop 分流仍是**配置驱动**（`GlobalConfig.fastPath`，缺省回退原冻结基线），
 *   debug 日志字段（preview/complexity/dangerousTool）逐字保留；
 * - Code Mode 灰度仍按 message 粒度 hash 判定；`CODE_MODE` 关闭恒 `false`。
 *
 * ⚠️ 与原实现的唯一差别（如实）：`CODE_MODE_TRAFFIC_PERCENT` 由"实例构造时读一次"改为
 * "首次决策时读一次并缓存"（env 在本进程生命周期内不变，实测无行为差异；
 * 且避免了模块加载早于 env 注入时读到空值）。
 */

import { getLogger } from '@modules/monitoring';
import { feature as coreFeature } from '@openliri/kernel';
import { configManager } from '@modules/config';
import {
  classifyTaskComplexity,
  hasDangerousToolIntent,
  isEligibleForFastPath,
  resolveFastPathPolicy,
} from '@modules/tasks';

const logger = getLogger('chat:manager');

let codeModeTrafficPercentCache: number | null = null;

/** CM-6（2026-08-25）：Code Mode 自动分流灰度百分比（0~100，默认 0） */
function codeModeTrafficPercent(): number {
  if (codeModeTrafficPercentCache !== null) return codeModeTrafficPercentCache;
  const raw = configManager.env('CODE_MODE_TRAFFIC_PERCENT');
  const val = raw && !isNaN(Number(raw)) ? Number(raw) : 0;
  codeModeTrafficPercentCache = Math.min(100, Math.max(0, val));
  return codeModeTrafficPercentCache;
}

/** message 粒度 hash（S3：字符串散列 → 0~99，避开 sessionId 偏差） */
export function hashMessage(message: string): number {
  let hash = 0;
  for (let i = 0; i < message.length; i++) {
    hash = (hash * 31 + message.charCodeAt(i)) >>> 0;
  }
  return hash % 100;
}

/**
 * 是否走 PlanDrivenLoop（复杂任务编排）。
 *
 * T-②05（2026-10-03）：判据改为**配置驱动**（GlobalConfig.fastPath；缺省回退原冻结基线）。
 */
export function shouldUsePlanDrivenLoop(message: string): boolean {
  const policy = resolveFastPathPolicy();
  if (!isEligibleForFastPath(message, policy)) {
    logger.debug('PlanDrivenLoop 分流：复杂度门/危险工具筛除', {
      messagePreview: message.slice(0, 50),
      complexity: classifyTaskComplexity(message, policy.maxSimpleTaskLength),
      dangerousTool: hasDangerousToolIntent(
        message,
        policy.dangerousIntentPatterns
      ),
    });
    return false;
  }
  return true;
}

/**
 * CM-6：Code Mode 分流决策（与 `shouldUsePlanDrivenLoop` 平级）
 * `CODE_MODE` feature 关闭 → 恒 false（不注入 code_run 建议）；
 * 灰度命中表示"本轮建议走 code_run 编排"（用于与 PDCA launch 互斥）。
 * 工具注册/模型显式选择 code_run 不受此函数控制（优先级更高）。
 */
export function shouldUseCodeMode(message: string): boolean {
  if (!coreFeature('CODE_MODE')) return false;
  const percent = codeModeTrafficPercent();
  if (percent >= 100) return true;
  if (percent <= 0) return false;
  const hash = hashMessage(message);
  const shouldUse = hash < percent;
  logger.info('Code Mode 分流', {
    messagePreview: message.slice(0, 50),
    hash,
    trafficPercent: percent,
    shouldUse,
  });
  return shouldUse;
}
