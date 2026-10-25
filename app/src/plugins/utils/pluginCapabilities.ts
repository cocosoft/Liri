/**
 * 插件**能力声明与授权**（T25-08 P2，2026-10-25）。
 *
 * 方案：`.trae/specs/plugin-process-isolation.md` §4「P2：市场 / 安装链路改造」+ §6 验收
 * 「未授权能力 ⇒ 拒绝安装/启用」。
 *
 * 分工（与 P0/P1 正交）：
 * - **P0 准入闸**（`pluginTrust.ts`）：这份代码**能不能跑**；
 * - **P1 子进程宿主**（`plugins/host/*`）：跑在**哪个进程**；
 * - **P2 能力授权**（本文件）：跑起来后**允许做什么**。
 *
 * 口径（如实）：
 * - 能力是**闭合集合**（与 P1 的能力面一一对偶），清单里出现集合外的名字 ⇒ 视为**清单非法**，
 *   安装与加载都拒绝（不猜"未知能力大概等于允许"）；
 * - 旧清单**未声明** `capabilities` ⇒ 取保守默认 `['tools']`（历史插件唯一接过线的能力面）；
 * - 授权表 `LIRI_PLUGIN_CAPABILITY_GRANTS=<id>:<cap>[,<cap>][;<id>:…]` **未配置** ⇒
 *   不做能力门控（零行为变更；仍受 P0 准入闸约束）。一旦配置 ⇒ **fail-closed**：
 *   声明了但未授权的能力 ⇒ 拒绝安装 / 拒绝加载，并回传缺哪几项。
 */
import { configManager } from '@modules/config';

/** 能力闭合集合（新增能力必须同时落到 P1 的提供面，否则只声明不兑现） */
export const PLUGIN_CAPABILITIES = ['tools', 'config', 'events'] as const;

export type PluginCapability = (typeof PLUGIN_CAPABILITIES)[number];

/** 旧清单（未声明 capabilities）的保守默认：只给历史唯一接线过的能力 */
export const LEGACY_DEFAULT_CAPABILITIES: readonly PluginCapability[] = [
  'tools',
];

/** 授权表环境变量名 */
export const PLUGIN_CAPABILITY_GRANTS_ENV = 'LIRI_PLUGIN_CAPABILITY_GRANTS';

/** 拒绝时的放行指引（与日志/接口错误文案同源） */
export const PLUGIN_CAPABILITY_REMEDY =
  `放行方式：在 .env 设置 ${PLUGIN_CAPABILITY_GRANTS_ENV}=<插件id>:<能力>[,<能力>]` +
  `（多插件用分号分隔，能力可选 ${PLUGIN_CAPABILITIES.join(' / ')}）后重启。`;

/** 声明解析结果 */
export interface DeclaredCapabilities {
  /** 合法能力（保持清单顺序、去重） */
  declared: PluginCapability[];
  /** 集合外的能力名（清单非法） */
  unknown: string[];
  /** `capabilities` 不是字符串数组（清单非法） */
  malformed: boolean;
}

/**
 * 解析 `manifest.capabilities`（纯函数）。
 *
 * `undefined` / `null` ⇒ 走旧清单默认；非数组 ⇒ `malformed`（不把单字符串当数组猜）。
 */
export function parseDeclaredCapabilities(raw: unknown): DeclaredCapabilities {
  if (raw === undefined || raw === null) {
    return {
      declared: [...LEGACY_DEFAULT_CAPABILITIES],
      unknown: [],
      malformed: false,
    };
  }
  if (!Array.isArray(raw)) {
    return { declared: [], unknown: [], malformed: true };
  }
  const declared: PluginCapability[] = [];
  const unknown: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') {
      return { declared: [], unknown: [], malformed: true };
    }
    if ((PLUGIN_CAPABILITIES as readonly string[]).includes(item)) {
      const cap = item as PluginCapability;
      if (!declared.includes(cap)) declared.push(cap);
    } else if (!unknown.includes(item)) {
      unknown.push(item);
    }
  }
  return { declared, unknown, malformed: false };
}

/**
 * 解析授权表：`id:tools,config;id2:events`（纯函数）。
 *
 * 非法片段（缺冒号 / 空 id）⇒ 跳过该片段（不猜归属）；能力名不做合法性校验 ——
 * 未知能力名在 `decidePluginCapabilities` 里不会被任何清单命中，等于无效授权。
 */
export function parseCapabilityGrants(
  raw: string | undefined | null
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  if (!raw) return out;
  for (const chunk of raw.split(';')) {
    const idx = chunk.indexOf(':');
    if (idx <= 0) continue;
    const pluginId = chunk.slice(0, idx).trim();
    if (!pluginId) continue;
    const caps = chunk
      .slice(idx + 1)
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const set = out.get(pluginId) ?? new Set<string>();
    for (const cap of caps) set.add(cap);
    out.set(pluginId, set);
  }
  return out;
}

/** 能力判定结果（供安装链路与加载器共用） */
export interface CapabilityDecision {
  allowed: boolean;
  declared: PluginCapability[];
  granted: PluginCapability[];
  /** 声明了但未授权（fail-closed 的直接原因） */
  missing: PluginCapability[];
  unknown: string[];
  malformed: boolean;
  /** 授权表是否已配置（未配置 ⇒ 不做门控） */
  enforced: boolean;
}

/**
 * 能力判定（纯函数）。
 *
 * @param grants 授权表（缺省空表）
 * @param enforce 是否启用门控（缺省 `false` = 零行为变更）
 */
export function decidePluginCapabilities(input: {
  pluginId: string;
  manifestCapabilities: unknown;
  grants?: ReadonlyMap<string, Set<string>>;
  enforce?: boolean;
}): CapabilityDecision {
  const parsed = parseDeclaredCapabilities(input.manifestCapabilities);
  const enforced = input.enforce === true;

  if (parsed.malformed || parsed.unknown.length > 0) {
    return {
      allowed: false,
      declared: parsed.declared,
      granted: [],
      missing: [],
      unknown: parsed.unknown,
      malformed: parsed.malformed,
      enforced,
    };
  }

  if (!enforced) {
    return {
      allowed: true,
      declared: parsed.declared,
      granted: [...parsed.declared],
      missing: [],
      unknown: [],
      malformed: false,
      enforced: false,
    };
  }

  const allowedSet = input.grants?.get(input.pluginId) ?? new Set<string>();
  const granted = parsed.declared.filter((c) => allowedSet.has(c));
  const missing = parsed.declared.filter((c) => !allowedSet.has(c));
  return {
    allowed: missing.length === 0,
    declared: parsed.declared,
    granted,
    missing,
    unknown: [],
    malformed: false,
    enforced: true,
  };
}

/** 授权表是否已配置（生产入口：env 非空即视为显式启用门控） */
export function isCapabilityEnforcementEnabled(): boolean {
  return (
    (configManager.env(PLUGIN_CAPABILITY_GRANTS_ENV) ?? '').trim().length > 0
  );
}

/** 生产调用点唯一入口：读 env 后判定（安装链路与加载器共用） */
export function resolvePluginCapabilities(
  pluginId: string,
  manifestCapabilities: unknown
): CapabilityDecision {
  const raw = configManager.env(PLUGIN_CAPABILITY_GRANTS_ENV);
  return decidePluginCapabilities({
    pluginId,
    manifestCapabilities,
    grants: parseCapabilityGrants(raw),
    enforce: (raw ?? '').trim().length > 0,
  });
}

/** 拒绝原因（人类可读；含缺哪几项 / 非法项） */
export function describeCapabilityDenial(decision: CapabilityDecision): string {
  if (decision.malformed) {
    return `插件清单的 capabilities 必须是字符串数组（可选 ${PLUGIN_CAPABILITIES.join(' / ')}）。`;
  }
  if (decision.unknown.length > 0) {
    return `插件清单声明了未知能力：${decision.unknown.join(', ')}（可选 ${PLUGIN_CAPABILITIES.join(' / ')}）。`;
  }
  return `插件声明了未授权能力：${decision.missing.join(', ')}。${PLUGIN_CAPABILITY_REMEDY}`;
}
