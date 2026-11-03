/**
 * 项目工作区根的**唯一解析入口**（P2，2026-11-03）
 *
 * 为什么单独一层：优先级（`LIRI_PROJECTS_DIR` > 用户设置 > 默认）由
 * `@openliri/infra/environment` 的 `resolveDefaultProjectWorkspaceRoot()` 决定，
 * 但"用户设置"来自 `config` 层 —— 如果让 `environment` 反过来读 `config` 会形成
 * **模块循环依赖**（`userSettings` 已经依赖 `resolvePyappHome`）。
 *
 * 故：env / 默认值留在 infra 纯函数里，**读设置这一步只放在本层**（app 依赖 infra 合法），
 * 业务侧（`ProjectStore`）只依赖本模块，避免再出现"某处自己拼 homedir"的第二事实源。
 */

import {
  loadUserSettings,
  PROJECTS_DIRECTORY_SETTING_KEY,
} from '@openliri/infra/config';
import { resolveDefaultProjectWorkspaceRoot } from '@openliri/infra/environment';

export { PROJECTS_DIRECTORY_SETTING_KEY };

/**
 * 解析项目工作区根：`LIRI_PROJECTS_DIR` > 设置 `projectsDirectory` > `~/Documents/LiriProjects`。
 *
 * 只做路径计算，**不创建目录**（是否建由调用方决定，与 `resolveToolCwd` 同口径）。
 */
export function resolveProjectWorkspaceRoot(): string {
  const configured = loadUserSettings()[PROJECTS_DIRECTORY_SETTING_KEY];
  return resolveDefaultProjectWorkspaceRoot(process.env, {
    configuredDir: typeof configured === 'string' ? configured : null,
  });
}
