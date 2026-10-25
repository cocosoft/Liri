/**
 * Python 插件**旧配置迁移**（2026-10-25，收敛 config 双轨）。
 *
 * 背景：Python 插件此前把 `ctx.config` 写到 `<data>/plugin-config/<id>.json`（`PythonPluginAdapter`
 * 自带存储），而 Node 插件 / 市场 UI 写 `~/.pyapp/plugins/config/config.json`（`PluginConfigManager`）
 * ⇒ 同一插件两份配置、互不可见。现在统一到后者，本文件只负责**把旧文件一次性并入**。
 *
 * 口径：
 * - 只补「共用存储里**还没有**的键」⇒ 不覆盖 UI/Node 侧写入的新值；
 * - 任一键被 schema 拒绝 ⇒ 停止并**保留旧文件**（下次启动再试，不静默丢数据）；
 * - 全部导入/已存在 ⇒ 旧文件改名 `.migrated` 留档（**不删除**，见 `.trae/rules/code-deletion.md` CD06）。
 *
 * 纯逻辑 + 可控 IO（路径由调用方传入）⇒ 可直接单测，不需要 spawn Python。
 */
import { existsSync, readFileSync, renameSync } from 'node:fs';
import type { PluginConfigPort } from '../host/pluginConfigPort';

/** 迁移结论（调用方据此记日志；`blocked`/`invalid` 都保留旧文件） */
export type LegacyConfigMigrationStatus =
  | 'absent'
  | 'invalid'
  | 'blocked'
  | 'migrated'
  | 'rename-failed';

export interface LegacyConfigMigrationResult {
  status: LegacyConfigMigrationStatus;
  /** 本次真正写入共用存储的键（已存在的不计） */
  importedKeys: string[];
  /** `blocked` 时被拒的键与原因 */
  blockedKey?: string;
  errors?: string[];
  /** `invalid` 时的原因（解析失败 / 不是对象） */
  invalidReason?: string;
}

export function migrateLegacyPythonConfig(input: {
  pluginId: string;
  port: PluginConfigPort;
  legacyPath: string;
}): LegacyConfigMigrationResult {
  const { pluginId, port, legacyPath } = input;
  if (!existsSync(legacyPath)) return { status: 'absent', importedKeys: [] };

  let legacy: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(readFileSync(legacyPath, 'utf-8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        status: 'invalid',
        importedKeys: [],
        invalidReason: '旧配置不是 JSON 对象',
      };
    }
    legacy = parsed as Record<string, unknown>;
  } catch (error) {
    return {
      status: 'invalid',
      importedKeys: [],
      invalidReason: String(error),
    };
  }

  const current = port.read(pluginId);
  const importedKeys: string[] = [];
  for (const [key, value] of Object.entries(legacy)) {
    if (key in current) continue;
    const result = port.write(pluginId, key, value);
    if (!result.ok) {
      return {
        status: 'blocked',
        importedKeys,
        blockedKey: key,
        errors: result.errors,
      };
    }
    importedKeys.push(key);
  }

  try {
    renameSync(legacyPath, `${legacyPath}.migrated`);
  } catch (error) {
    return {
      status: 'rename-failed',
      importedKeys,
      errors: [String(error)],
    };
  }
  return { status: 'migrated', importedKeys };
}
