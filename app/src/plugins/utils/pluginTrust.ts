/**
 * pluginTrust — 第三方插件**准入闸**（T25-08 P0，2026-10-25 用户裁定「默认拒绝 + 白名单」）
 *
 * ## 为什么需要
 * 插件在主进程内 `import` 执行（`plugins/core/PluginLoader.ts` 的 `import(entryPath)`）⇒
 * 与宿主同权限：可 `require('node:fs')` 读 `.env`、可 `spawn` 子进程。静态扫描挡不住混淆代码。
 * 在子进程宿主（spec P1）落地前，先用**准入闸**把"未授权的第三方代码"挡在进程外。
 *
 * ## 口径
 * - 第一方 bundled 插件（`plugins/bundled/*`）**不经过本闸**（其加载走 `BundledPluginManager`）；
 * - 第三方（`~/.pyapp/plugins/installed/**`、市场缓存、npm 安装物）⇒ **默认拒绝**；
 * - 放行两途：① `LIRI_PLUGIN_TRUSTED_IDS`（逗号/分号分隔，支持裸名与 `name@marketplace`）；
 *   ② 逃生开关 `FEATURE_PLUGIN_THIRD_PARTY_INPROCESS=true`（整体回到"旧行为"，用于灰度/自担风险）。
 * - 拒绝时**不静默**：调用方必须落 app.log 并把原因回给用户（含放行方法）。
 */
import { feature } from '@openliri/kernel';
import { configManager } from '@modules/config';

/** 信任判定来源（用于日志/审计） */
export type PluginTrustReason =
  | 'allowlisted'
  | 'in-process-optin'
  | 'untrusted';

export interface PluginTrustDecision {
  trusted: boolean;
  reason: PluginTrustReason;
}

/** 解析白名单（逗号或分号分隔；空项剔除；大小写敏感 —— 插件 id 本身大小写敏感） */
export function parseTrustedPluginIds(
  raw: string | undefined | null
): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(/[;,]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  );
}

/**
 * 纯判定（可单测）：逃生开关优先 → 白名单 → 拒绝。
 *
 * @param allowInProcess `FEATURE_PLUGIN_THIRD_PARTY_INPROCESS`（true = 回到旧行为）
 */
export function decidePluginTrust(input: {
  pluginId: string;
  trustedIds: ReadonlySet<string>;
  allowInProcess: boolean;
}): PluginTrustDecision {
  if (input.allowInProcess) {
    return { trusted: true, reason: 'in-process-optin' };
  }
  if (input.trustedIds.has(input.pluginId)) {
    return { trusted: true, reason: 'allowlisted' };
  }
  return { trusted: false, reason: 'untrusted' };
}

/** 读取 env + 开关后的实际判定（生产调用点唯一入口） */
export function isThirdPartyPluginTrusted(
  pluginId: string
): PluginTrustDecision {
  return decidePluginTrust({
    pluginId,
    trustedIds: parseTrustedPluginIds(
      configManager.env('LIRI_PLUGIN_TRUSTED_IDS')
    ),
    allowInProcess: feature('PLUGIN_THIRD_PARTY_INPROCESS'),
  });
}

/** 拒绝时给用户的放行指引（与日志/接口错误文案同源） */
export const PLUGIN_TRUST_REMEDY =
  '放行方式：在 .env 设置 LIRI_PLUGIN_TRUSTED_IDS=<插件id>（多个用逗号分隔）后重启；' +
  '或以 FEATURE_PLUGIN_THIRD_PARTY_INPROCESS=true 承担风险整体放行。';
