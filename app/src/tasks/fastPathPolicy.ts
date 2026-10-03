// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * fastPathPolicy —— 快速路径判据的**配置解析**（T-②05 / benchmark §6.4 #6，2026-10-03）
 *
 * 分工（CS01 + R06-006 GR03「判定与接线分离」）：
 * - **纯构造**在 `@modules/types/fastPath`（`buildFastPathPolicy` / `compileIntentPatterns`，零依赖）；
 * - 本模块只做「读配置 → 构造 → 非法项告警 → 记忆化」这段**接线**。
 *
 * 缓存：以「阈值 + 正则源码列表」为 key 记忆化 —— 分流判定在**每条用户消息**上执行，
 * 不能每次重编译正则 / 重复告警；配置变更（key 变）即自然失效，无需订阅事件。
 *
 * 失败口径（CS03）：配置缺失/非法**不抛错**，回退默认（fail-closed）；仅对**被忽略的
 * 非法项**告警，且因记忆化而**至多告警一次**（同一配置）。
 */

import { configManager } from '@modules/config';
import { getLogger } from '@modules/monitoring';
import {
  buildFastPathPolicy,
  type FastPathConfig,
  type FastPathPolicy,
} from '@modules/types/fastPath';

const logger = getLogger('tasks:fastPathPolicy');

/** 记忆化缓存（key 由「阈值 + 正则源码」拼成；配置变更即自然失效） */
let cachedKey: string | null = null;
let cachedPolicy: FastPathPolicy | null = null;

/** 由配置对象派生缓存键（`\u0000` 分隔，避免源码内含分隔符造成歧义） */
function policyKey(config: FastPathConfig | undefined): string {
  const max = config?.maxSimpleTaskLength;
  const patterns = Array.isArray(config?.dangerousIntentPatterns)
    ? (config?.dangerousIntentPatterns as unknown[])
    : [];
  return `${typeof max === 'number' ? max : ''}\u0000${patterns.join('\u0000')}`;
}

/**
 * 解析当前生效的快速路径判据（读 `GlobalConfig.fastPath`）。
 *
 * 配置缺失/非法 ⇒ 回退默认（见 `buildFastPathPolicy`）；**不返回 null**，调用方无需判空。
 */
export function resolveFastPathPolicy(): FastPathPolicy {
  const global = configManager.getGlobalConfig();
  const config: FastPathConfig | undefined = global?.fastPath;

  const key = policyKey(config);
  if (key === cachedKey && cachedPolicy) return cachedPolicy;

  const { policy, invalidPatterns } = buildFastPathPolicy(config ?? null);
  if (invalidPatterns.length > 0) {
    logger.warn('快速路径危险意图正则：非法/超长项已忽略', {
      count: invalidPatterns.length,
      patterns: invalidPatterns,
    });
  }
  cachedKey = key;
  cachedPolicy = policy;
  return policy;
}
