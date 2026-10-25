/**
 * 插件**能力授权**的持久化（T25-08 P2 · 市场 UI 勾选授权，2026-10-25）。
 *
 * 背景：授权此前只能改 `.env`（`LIRI_PLUGIN_CAPABILITY_GRANTS`）。市场页要让用户勾选，
 * 就必须有可写、可回读的落点 —— 但**不新建第二套判定**：本文件只负责存取，
 * 判定仍由 `pluginCapabilities.decidePluginCapabilities()` 做（env 与文件在调用处合并）。
 *
 * 落点：`<plugins 根>/capability-grants.json`（与 `plugins/config/config.json` 同级的单文件，
 * 经 `resolvePluginsDir()` 取根，不自建路径常量 —— paths.md）。
 *
 * 形状：
 * ```json
 * { "version": 1, "grants": { "<pluginId>": ["tools", "config"] } }
 * ```
 *
 * 失败语义（如实）：文件损坏 ⇒ **当作空表**并保留原文件（不覆盖用户数据），由调用方按
 * "未配置门控"处理；写盘用 tmp + rename，避免半写文件让下次读取整体失效。
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { resolvePluginsDir } from '@openliri/kernel';

/** 授权文件名（位于插件根目录下） */
export const PLUGIN_CAPABILITY_GRANTS_FILE = 'capability-grants.json';

/** 文件版本（便于将来迁移） */
const GRANTS_FILE_VERSION = 1;

/** 授权文件路径（跟随当前进程的 LIRI_HOME / LIRI_DATA_DIR） */
export function resolveCapabilityGrantsPath(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolvePluginsDir(env), PLUGIN_CAPABILITY_GRANTS_FILE);
}

/**
 * 读取授权表（`pluginId → 能力名集合`）。
 *
 * 文件不存在 / JSON 坏 / 形状不符 ⇒ 返回空表（**不抛**：调用方据此走"未配置门控"）。
 */
export function readCapabilityGrants(
  filePath: string = resolveCapabilityGrantsPath()
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  if (!existsSync(filePath)) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    // @ignore-catch — 坏文件按空表处理（见文件头"失败语义"），不在此处覆盖用户数据
    return out;
  }
  const grants = (parsed as { grants?: unknown } | null)?.grants;
  if (!grants || typeof grants !== 'object' || Array.isArray(grants))
    return out;
  for (const [pluginId, caps] of Object.entries(
    grants as Record<string, unknown>
  )) {
    if (!pluginId || !Array.isArray(caps)) continue;
    const set = new Set<string>();
    for (const cap of caps) if (typeof cap === 'string' && cap) set.add(cap);
    out.set(pluginId, set);
  }
  return out;
}

/**
 * 写入某插件的授权集合（覆盖该插件条目，保留其它插件）。
 *
 * 空数组 ⇒ **删除该条目**（语义 = 不授权任何能力，同时不留 `"id": []` 噪声）。
 */
export function writeCapabilityGrants(
  pluginId: string,
  capabilities: readonly string[],
  filePath: string = resolveCapabilityGrantsPath()
): void {
  const current = readCapabilityGrants(filePath);
  if (capabilities.length === 0) current.delete(pluginId);
  else current.set(pluginId, new Set(capabilities));

  const grants: Record<string, string[]> = {};
  for (const [id, caps] of current) grants[id] = [...caps].sort();

  mkdirSync(resolvePluginsDir(), { recursive: true });
  const payload = JSON.stringify(
    { version: GRANTS_FILE_VERSION, grants },
    null,
    2
  );
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, payload, 'utf-8');
  renameSync(tmp, filePath);
}
