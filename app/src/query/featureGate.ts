// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * featureGate.ts — 用户可配的功能开关解析（2026-11-03）
 *
 * 背景（与 AlwaysOn 死开关同源）：`kernel#feature()` 只读 **env → 构建变体 → 静态默认**，
 * 不看用户配置；而设置页写的是 `config.features.<key>` ⇒ 仅靠 `feature()` 的门控在桌面版
 * 永远打不开（用户在设置里开了也没用）。
 *
 * 本模块是**用户可配门控的唯一解析入口**：优先级 = env（运维/灰度）> 用户设置 > `feature()`。
 * 只有登记在 {@link USER_CONFIG_KEYS} 的开关才读配置；其余开关逐字走 `feature()`（零行为变化）。
 *
 * ⚠️ 生效时机：调用方**每轮/每次请求**重新解析（不缓存），所以设置页改动立即生效，无需重启。
 *
 * 分层：本文件属 app 层（`query`），只依赖 core 的 `feature` 与 infra 的 `configManager`。
 */
import { feature } from '@openliri/kernel';
import type { FeatureFlag } from '@openliri/kernel';
import { configManager } from '@openliri/infra/config';

/** 设置页「功能开关」在配置里的节名（`PUT /v1/config/features`） */
const USER_FEATURE_CONFIG_SECTION = 'features';

/**
 * 用户可配的开关 ↔ 配置键（**唯一登记点**）。
 *
 * 新增一项 = 设置页加一个 Toggle + 在此登记一行；未登记 ⇒ 该开关仍只认 env / 变体 / 默认。
 * `SELF_VERIFY_PATTERN`（2026-11-03）：自校验/多轮精修线路的总门控。
 */
const USER_CONFIG_KEYS: Readonly<Partial<Record<FeatureFlag, string>>> = {
  SELF_VERIFY_PATTERN: 'selfVerifyPattern',
  // 2026-11-03（缺口 #3）：研究编排（competitive_strategy）同属"桌面默认不可达"的门控
  COMPETITIVE_STRATEGY: 'competitiveStrategy',
};

/** 用户设置的读取器（测试可注入） */
export type UserFeatureReader = (flag: FeatureFlag) => boolean | undefined;

/** 默认读取器：只认已登记开关的布尔值；缺失 / 非布尔 ⇒ `undefined`（不干预） */
function readUserFeatureValue(flag: FeatureFlag): boolean | undefined {
  const key = USER_CONFIG_KEYS[flag];
  if (!key) return undefined;
  const section = configManager.getConfigValue(USER_FEATURE_CONFIG_SECTION) as
    | Record<string, unknown>
    | undefined;
  const value = section?.[key];
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * 解析功能开关（用户可配版）。
 *
 * 优先级：`FEATURE_<name>` env（显式运维控制，最高）> 用户设置（仅已登记开关）> `feature()`。
 *
 * @param flag 功能开关名
 * @param readUserValue 用户设置读取器（测试注入；缺省读 `config.features`）
 */
export function resolveFeatureGate(
  flag: FeatureFlag,
  readUserValue: UserFeatureReader = readUserFeatureValue
): boolean {
  // env 已显式指定 ⇒ 不读用户设置（与 AlwaysOn 同口径：运维/灰度优先）
  if (process.env[`FEATURE_${flag}`] !== undefined) return feature(flag);
  // 准入点是**登记表**：未登记的开关不读用户设置（注入 reader 也不能绕过，零行为变化）
  if (!USER_CONFIG_KEYS[flag]) return feature(flag);
  const userValue = readUserValue(flag);
  if (userValue !== undefined) return userValue;
  return feature(flag);
}
