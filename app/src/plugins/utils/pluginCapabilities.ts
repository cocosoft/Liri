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
import { readCapabilityGrants } from './pluginCapabilityGrantsStore';

/** 能力闭合集合（新增能力必须同时落到 P1 的提供面，否则只声明不兑现） */
export const PLUGIN_CAPABILITIES = ['tools', 'config', 'events'] as const;

export type PluginCapability = (typeof PLUGIN_CAPABILITIES)[number];

/**
 * **已进词汇表但尚未实现**的能力（2026-10-25）。
 *
 * 为什么单独一张表而不是直接从 `PLUGIN_CAPABILITIES` 删掉：`events` 是 spec §4 规划的
 * 能力名（将来要实现），删掉会让它变成「未知能力」，报错语义不准；留在这里则表示
 * 「名字合法、但**当前没有任何提供面**」⇒ 声明即拒绝（fail-closed）。
 *
 * 判据（实测）：子进程 context 的 `events` 是 SDK 的安全空实现（`plugin-sdk/core.ts`），
 * 授权了也只会得到一个永远不触发的 `on/emit` —— 与 T25-08 P2 之前的 `config` 同型。
 *
 * **实现 `events` 后请把它从本集合移出**，并同步 bump 下面的「可用能力」文案与测试。
 */
export const PLUGIN_CAPABILITIES_UNIMPLEMENTED: readonly PluginCapability[] = [
  'events',
];

/** 当前**真正可用**的能力（= 词汇表 − 未实现） */
export const PLUGIN_CAPABILITIES_IMPLEMENTED: readonly PluginCapability[] =
  PLUGIN_CAPABILITIES.filter(
    (cap) => !PLUGIN_CAPABILITIES_UNIMPLEMENTED.includes(cap)
  );

/** 旧清单（未声明 capabilities）的保守默认：只给历史唯一接线过的能力 */
export const LEGACY_DEFAULT_CAPABILITIES: readonly PluginCapability[] = [
  'tools',
];

/** 授权表环境变量名 */
export const PLUGIN_CAPABILITY_GRANTS_ENV = 'LIRI_PLUGIN_CAPABILITY_GRANTS';

/** 拒绝时的放行指引（与日志/接口错误文案同源；只列**已实现**的能力） */
export const PLUGIN_CAPABILITY_REMEDY =
  `放行方式：在 .env 设置 ${PLUGIN_CAPABILITY_GRANTS_ENV}=<插件id>:<能力>[,<能力>]` +
  `（多插件用分号分隔，可选 ${PLUGIN_CAPABILITIES_IMPLEMENTED.join(' / ')}）后重启。`;

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
  /** 声明了但**尚未实现**（名字合法、当前无任何提供面；与授权与否无关） */
  unimplemented: PluginCapability[];
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
      unimplemented: [],
      malformed: parsed.malformed,
      enforced,
    };
  }

  // 未实现的能力 ⇒ **无论授权表怎么配**都拒绝：授权不能凭空造出提供面，
  // 放行只会让插件拿到一个永远不触发的空实现（静默失效）。
  const unimplemented = parsed.declared.filter((cap) =>
    PLUGIN_CAPABILITIES_UNIMPLEMENTED.includes(cap)
  );
  if (unimplemented.length > 0) {
    return {
      allowed: false,
      declared: parsed.declared,
      granted: [],
      missing: [],
      unknown: [],
      unimplemented,
      malformed: false,
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
      unimplemented: [],
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
    unimplemented: [],
    malformed: false,
    enforced: true,
  };
}

/** 授权表是否已配置（env 或文件任一非空即视为显式启用门控） */
export function isCapabilityEnforcementEnabled(): boolean {
  const raw = (configManager.env(PLUGIN_CAPABILITY_GRANTS_ENV) ?? '').trim();
  if (raw.length > 0) return true;
  return readCapabilityGrants().size > 0;
}

/**
 * 合并两个授权来源（纯函数）：**取并集**。
 *
 * env 与市场 UI 写下的文件是同一件事的两个入口，不存在"谁覆盖谁"——用户从任一处放行都算
 * 放行；收窄则要两处都移除（文件里的空数组会被 `writeCapabilityGrants` 直接删条目）。
 */
export function mergeCapabilityGrants(
  envGrants: ReadonlyMap<string, Set<string>>,
  fileGrants: ReadonlyMap<string, Set<string>>
): Map<string, Set<string>> {
  const merged = new Map<string, Set<string>>();
  for (const [id, caps] of envGrants) merged.set(id, new Set(caps));
  for (const [id, caps] of fileGrants) {
    const existing = merged.get(id);
    if (!existing) {
      merged.set(id, new Set(caps));
      continue;
    }
    for (const cap of caps) existing.add(cap);
  }
  return merged;
}

/** 生产调用点唯一入口：读 env + 持久化授权表后判定（安装链路与加载器共用） */
export function resolvePluginCapabilities(
  pluginId: string,
  manifestCapabilities: unknown
): CapabilityDecision {
  const raw = configManager.env(PLUGIN_CAPABILITY_GRANTS_ENV);
  const envGrants = parseCapabilityGrants(raw);
  const fileGrants = readCapabilityGrants();
  const enforce = (raw ?? '').trim().length > 0 || fileGrants.size > 0;
  return decidePluginCapabilities({
    pluginId,
    manifestCapabilities,
    grants: mergeCapabilityGrants(envGrants, fileGrants),
    enforce,
  });
}

/**
 * 某插件**已放行**的能力名集合（env ∪ 文件）。
 *
 * 与 `resolvePluginCapabilities().granted` 的区别：后者是**门控结论**（被拒时为空数组），
 * 本函数是**展示视角**（即使清单因声明了未实现能力被整体拒绝，UI 仍需如实显示已勾选项）。
 */
export function readMergedCapabilityGrants(pluginId: string): Set<string> {
  const raw = configManager.env(PLUGIN_CAPABILITY_GRANTS_ENV);
  const merged = mergeCapabilityGrants(
    parseCapabilityGrants(raw),
    readCapabilityGrants()
  );
  return merged.get(pluginId) ?? new Set<string>();
}

/** 拒绝原因（人类可读；含未实现 / 缺哪几项 / 非法项） */
export function describeCapabilityDenial(decision: CapabilityDecision): string {
  if (decision.malformed) {
    return `插件清单的 capabilities 必须是字符串数组（可选 ${PLUGIN_CAPABILITIES.join(' / ')}）。`;
  }
  if (decision.unknown.length > 0) {
    return `插件清单声明了未知能力：${decision.unknown.join(', ')}（可选 ${PLUGIN_CAPABILITIES.join(' / ')}）。`;
  }
  if (decision.unimplemented.length > 0) {
    return (
      `插件声明了尚未实现的能力：${decision.unimplemented.join(', ')}` +
      `（当前可用：${PLUGIN_CAPABILITIES_IMPLEMENTED.join(' / ')}）。` +
      `请从清单移除该能力，或等对应能力面落地后再声明。`
    );
  }
  return `插件声明了未授权能力：${decision.missing.join(', ')}。${PLUGIN_CAPABILITY_REMEDY}`;
}
