/**
 * 按项目的「自主执行」开关（2026-11-03）
 *
 * **持久化**：`autonomy.projects`（`ConfigManager` 全局配置，与 `PUT /v1/config/autonomy.projects` 同源），
 * 结构 `{ [projectId]: { enabled: boolean } }`。
 *
 * **口径**：缺省 = 开（不写配置即保持全局行为）；只有显式 `enabled: false` 才暂停该项目。
 *
 * **为什么放 infra/config 而不是 `Project` 实体 / `tasks`（app）**：
 * - 不改项目 schema、不迁移存量项目；
 * - 读写方跨层（entry 直连、HTTP handler 属 service 层），放在 infra 才能同时被两者依赖
 *   （`service → app` 是反向依赖，`lint:arch` R00-001 会拦）。
 */
import { configManager } from './ConfigManager.js';

/** 配置键（`GET/PUT /v1/config/autonomy.projects`） */
export const PROJECT_AUTONOMY_CONFIG_KEY = 'autonomy.projects';

export interface ProjectAutonomyEntry {
  /** `false` ⇒ 暂停该项目的自主执行；缺省/`true` ⇒ 正常运行 */
  enabled?: boolean;
}

export type ProjectAutonomyMap = Record<string, ProjectAutonomyEntry>;

/** 读取整表（缺失 / 非对象 ⇒ 空表） */
export function readProjectAutonomyMap(): ProjectAutonomyMap {
  const value = configManager.getConfigValue(PROJECT_AUTONOMY_CONFIG_KEY);
  return value && typeof value === 'object'
    ? (value as ProjectAutonomyMap)
    : {};
}

/** 该项目是否允许自主执行（缺省 `true`） */
export function isProjectAutonomyEnabled(projectId: string): boolean {
  return readProjectAutonomyMap()[projectId]?.enabled !== false;
}

/**
 * 写入某项目的开关，返回写入后的整表。
 *
 * 持久化（含跨重启）由 `configManager.setConfigValue` 负责；运行期生效由订阅
 * `config:changed` 的 `alwaysOnEntry` 完成（与全局开关同一口径）。
 */
export function setProjectAutonomyEnabled(
  projectId: string,
  enabled: boolean
): ProjectAutonomyMap {
  const next: ProjectAutonomyMap = {
    ...readProjectAutonomyMap(),
    [projectId]: { enabled },
  };
  configManager.setConfigValue(PROJECT_AUTONOMY_CONFIG_KEY, next);
  return next;
}
