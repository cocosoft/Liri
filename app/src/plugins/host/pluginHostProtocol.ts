/**
 * 第三方插件**子进程宿主** —— 协议面与环境白名单（T25-08 P1）。
 *
 * 方案：`.trae/specs/plugin-process-isolation.md` §4「P1：子进程宿主」。
 *
 * 分帧**不另起一套**：复用 `@modules/utils/sidecarIpc`（`request` / `response` /
 * `notify` / `startup` / `heartbeat`）——与工具侧车同一契约。
 *
 * 本文件只放**纯函数 / 常量**（可单测、无副作用）：
 * - 方法名与事件名（闭合集合）；
 * - 子进程 env 的**白名单构造**（宿主的 `process.env` **不整体继承**）；
 * - 子进程 → 宿主的工具声明解析。
 */
import { parentPidEnvKey } from '@modules/utils/parentLiveness';
import type { PluginToolDeclaration } from '../utils/toolRegistration';

/** 子进程环境变量名（最小集；宿主不注入其它业务变量） */
export const PLUGIN_HOST_ENV_ID = 'LIRI_PLUGIN_ID';
export const PLUGIN_HOST_ENV_DIR = 'LIRI_PLUGIN_DIR';
export const PLUGIN_HOST_ENV_ENTRY = 'LIRI_PLUGIN_ENTRY';
export const PLUGIN_HOST_ENV_MARK = 'LIRI_PLUGIN_HOST';

/** 宿主 → 子进程 的方法名（`request.method`） */
export const PLUGIN_HOST_METHOD = {
  /** 执行插件声明的工具（handler 在子进程） */
  TOOL_EXECUTE: 'tool.execute',
  /** 执行生命周期钩子（`deactivate` / `destroy`） */
  LIFECYCLE: 'plugin.lifecycle',
  /** 优雅关停（执行 `destroy` 后自退） */
  SHUTDOWN: 'plugin.shutdown',
} as const;

/** 子进程 → 宿主 的通知事件名（`notify.event`） */
export const PLUGIN_HOST_EVENT = {
  /** 声明本插件提供的工具（无 handler，只有形状） */
  TOOLS_REGISTER: 'tools.register',
  /** 插件日志（`{level, message, meta?}`） */
  LOG: 'log',
  /** 启动失败（宿主据此**提前失败**而不是等超时） */
  START_FAILED: 'start.failed',
} as const;

/** 需要从宿主环境**继承**的键（进程可运行的最小集；其余一律不继承） */
const INHERITED_ENV_KEYS = [
  // POSIX
  'PATH',
  'HOME',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'TZ',
  // Windows
  'SystemRoot',
  'SystemDrive',
  'windir',
  'COMSPEC',
  'PATHEXT',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
] as const;

/** 宿主侧构造 env 的入参 */
export interface PluginHostEnvVars {
  pluginId: string;
  pluginDir: string;
  entryPath: string;
  /** 父进程 PID（缺省 `process.pid`）：供子进程看门狗自清 */
  parentPid?: number;
}

/**
 * 构造子进程 env：**白名单继承 + 最小注入**。
 *
 * 关键点：宿主的 `.env`（API Key 等）**不在白名单里** ⇒ 子进程 `process.env` 读不到
 * （这是 P1 的第一条负向验收）。
 */
export function buildPluginHostEnv(
  base: NodeJS.ProcessEnv,
  vars: PluginHostEnvVars
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of INHERITED_ENV_KEYS) {
    const value = base[key];
    if (typeof value === 'string' && value.length > 0) env[key] = value;
  }
  env[PLUGIN_HOST_ENV_ID] = vars.pluginId;
  env[PLUGIN_HOST_ENV_DIR] = vars.pluginDir;
  env[PLUGIN_HOST_ENV_ENTRY] = vars.entryPath;
  env[PLUGIN_HOST_ENV_MARK] = '1';
  env[parentPidEnvKey()] = String(vars.parentPid ?? process.pid);
  return env;
}

/** 子进程侧读回目标（缺任一必需项 ⇒ `null`，调用方 fail-closed） */
export function readPluginHostTarget(
  env: NodeJS.ProcessEnv
): PluginHostEnvVars | null {
  const pluginId = env[PLUGIN_HOST_ENV_ID];
  const pluginDir = env[PLUGIN_HOST_ENV_DIR];
  const entryPath = env[PLUGIN_HOST_ENV_ENTRY];
  if (!pluginId || !pluginDir || !entryPath) return null;
  return { pluginId, pluginDir, entryPath };
}

/**
 * 解析 `tools.register` 通知里的声明列表。
 *
 * 非 notify / 事件名不符 / `data.tools` 非数组 ⇒ `null`；单项不合法（无 `name`）⇒ 丢弃该项
 * （**不臆造**：宁可少注册，也不给不存在的工具造代理）。
 */
export function parseToolDeclarations(
  frame: Record<string, unknown> | null | undefined
): PluginToolDeclaration[] | null {
  if (!frame || frame.type !== 'notify') return null;
  if (frame.event !== PLUGIN_HOST_EVENT.TOOLS_REGISTER) return null;
  const data = frame.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const raw = (data as Record<string, unknown>).tools;
  if (!Array.isArray(raw)) return null;
  const out: PluginToolDeclaration[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const d = item as Record<string, unknown>;
    if (typeof d.name !== 'string' || d.name.length === 0) continue;
    out.push({
      name: d.name,
      description: typeof d.description === 'string' ? d.description : '',
      parameters:
        d.parameters && typeof d.parameters === 'object'
          ? (d.parameters as Record<string, unknown>)
          : undefined,
    });
  }
  return out;
}

/** 解析插件日志通知（非法 ⇒ `null`） */
export function parsePluginLog(
  frame: Record<string, unknown> | null | undefined
): { level: string; message: string } | null {
  if (!frame || frame.type !== 'notify') return null;
  if (frame.event !== PLUGIN_HOST_EVENT.LOG) return null;
  const data = frame.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.message !== 'string') return null;
  return {
    level: typeof d.level === 'string' ? d.level : 'info',
    message: d.message,
  };
}

/** 解析启动失败通知（非法 ⇒ `null`） */
export function parseStartFailed(
  frame: Record<string, unknown> | null | undefined
): string | null {
  if (!frame || frame.type !== 'notify') return null;
  if (frame.event !== PLUGIN_HOST_EVENT.START_FAILED) return null;
  const data = frame.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return '插件子进程启动失败（未给出原因）';
  }
  const message = (data as Record<string, unknown>).message;
  return typeof message === 'string' && message
    ? message
    : '插件子进程启动失败（未给出原因）';
}
