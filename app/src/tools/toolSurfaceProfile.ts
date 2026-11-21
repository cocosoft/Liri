// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * toolSurfaceProfile — 运行时**工具面 profile**（C2，2026-11-21；治理方案 v3 §14.1）
 *
 * ## 是什么
 * 用户在设置页选择的三档工具面：`minimal`（核心 9）/ `standard`（现状 12–13）/ `full`（全量）。
 * 持久化落点 `settings.toolSurface`（沿用 `GET/PUT /v1/settings/{ns}` 通用端点，**不新增路由**），
 * **每轮现读**（与 `featureGate` 同口径：改设置立即生效，无需重启）。
 *
 * ## 不是什么
 * - **不是删除 / 不是注销**：三档只改"本轮下发给模型的工具面"，工具仍注册可调用；
 *   隐藏项可经 `tool_search select:<name>` 拉入下一轮（`discoveredToolNames` 通路）。
 * - **不是权限**：`minimal` 不减审批 / 沙箱 / PathGuard；`full` 也不放行任何副作用（CS03 同源）。
 *
 * ## 默认
 * `standard` ⇒ 未配置 `settings.toolSurface` 时与改动前**逐字等价**（零行为变更，D5）。
 */

import { configManager } from '@openliri/infra/config';
import { getLogger } from '@openliri/infra/monitoring';

const logger = getLogger('tools:surfaceProfile');

/** 工具面档位 */
export type ToolSurfaceProfile = 'minimal' | 'standard' | 'full';

/**
 * 持久化落点：`~/.pyapp/config.json` 的 **`settings.toolSurface`**。
 *
 * 形状支持两种（手工编辑 config.json 也要能用）：
 * - `{ "profile": "minimal" }`（设置页写入形态）；
 * - `"minimal"`（扁平字符串）。
 */
export const TOOL_SURFACE_SETTINGS_KEY = 'settings.toolSurface';

/** 默认档位 = 现状披露面（D5：合入即零行为变更） */
export const DEFAULT_TOOL_SURFACE_PROFILE: ToolSurfaceProfile = 'standard';

const PROFILES: ReadonlySet<string> = new Set<ToolSurfaceProfile>([
  'minimal',
  'standard',
  'full',
]);

/** 已告警的非法取值（一次性，避免每轮刷屏） */
const warnedInvalid = new Set<string>();

/**
 * 归一化任意入参为合法档位（非法 / 缺失 ⇒ `standard`，并一次性告警）。
 *
 * 与 `normalizeToolVisibilityOverrides` 同口径：**读取侧校验**（单一真源），
 * 手工改 config.json / HTTP 写入的未校验值都走同一口径。
 */
export function normalizeToolSurfaceProfile(raw: unknown): ToolSurfaceProfile {
  const candidate =
    typeof raw === 'string'
      ? raw
      : typeof raw === 'object' && raw !== null
        ? (raw as { profile?: unknown }).profile
        : undefined;
  if (typeof candidate === 'string' && PROFILES.has(candidate)) {
    return candidate as ToolSurfaceProfile;
  }
  if (candidate !== undefined && !warnedInvalid.has(String(candidate))) {
    warnedInvalid.add(String(candidate));
    logger.warn('settings.toolSurface 取值非法 ⇒ 回退 standard', {
      value: String(candidate),
      allowed: [...PROFILES],
    });
  }
  return DEFAULT_TOOL_SURFACE_PROFILE;
}

/** 读当前档位（每轮现读 `ConfigManager` 内存缓存 ⇒ 无 IO） */
export function readToolSurfaceProfile(): ToolSurfaceProfile {
  return normalizeToolSurfaceProfile(
    configManager.getConfigValue(TOOL_SURFACE_SETTINGS_KEY)
  );
}

/**
 * **L0 核心工具**（`minimal` 档的恒定面；与任务类型无关，可预测、可门禁）。
 *
 * 组成（D2）：平台 shell 二选一 + 8 项通用核心 = **9**。
 * - shell：`win32` ⇒ `powershell`，其余 ⇒ `bash`（D3：不双壳，避免两套安全链同时暴露）；
 * - `tool_search` **必含**：否则其余工具对模型永久不可达（功能缺失，不是预算决策）；
 * - `todo_write`：长任务进度可见性（`minimal` 下若 `TODO` 关闭，该工具不注册 ⇒ 自然缺席）。
 *
 * ⚠️ 与**编译期** `CORE_MINIMAL_TOOL_KEYS`（`utils/ToolManagerUtils.ts`，7 项）区分：
 * 那份是产物裁剪（只 core 变体生效），本函数是**运行时**选择面（任意变体可切）。
 */
const CORE_COMMON_TOOL_NAMES: readonly string[] = [
  'file_read',
  'file_write',
  'file_edit',
  'grep',
  'glob',
  'ask_user_question',
  'todo_write',
  'tool_search',
];

/** 取 L0 核心工具名（平台 shell 二选一） */
export function getCoreToolNames(
  platform: NodeJS.Platform = process.platform
): readonly string[] {
  return [
    platform === 'win32' ? 'powershell' : 'bash',
    ...CORE_COMMON_TOOL_NAMES,
  ];
}
