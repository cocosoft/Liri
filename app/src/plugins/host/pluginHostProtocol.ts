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
import { buildRequestFrame } from '@modules/utils/sidecarIpc';
import type { PluginToolDeclaration } from '../utils/toolRegistration';

/** 子进程环境变量名（最小集；宿主不注入其它业务变量） */
export const PLUGIN_HOST_ENV_ID = 'LIRI_PLUGIN_ID';
export const PLUGIN_HOST_ENV_DIR = 'LIRI_PLUGIN_DIR';
export const PLUGIN_HOST_ENV_ENTRY = 'LIRI_PLUGIN_ENTRY';
export const PLUGIN_HOST_ENV_MARK = 'LIRI_PLUGIN_HOST';
/**
 * 插件**配置快照**（JSON 一行；仅当 `config` 能力已授权时注入）。
 *
 * 为什么走 env 而不是首帧请求：`config.get` 是**同步**签名（`PluginContext.config.get`
 * 不是 Promise），插件在 `initialize` 里就会读 ⇒ 必须在拉起时已经拿到，不能等往返。
 * 写入（`config.set`/`save`）才走 RPC（见 `PLUGIN_HOST_CHILD_METHOD`）。
 */
export const PLUGIN_HOST_ENV_CONFIG = 'LIRI_PLUGIN_CONFIG';

/** 宿主 → 子进程 的方法名（`request.method`） */
export const PLUGIN_HOST_METHOD = {
  /** 执行插件声明的工具（handler 在子进程） */
  TOOL_EXECUTE: 'tool.execute',
  /** 执行生命周期钩子（`deactivate` / `destroy`） */
  LIFECYCLE: 'plugin.lifecycle',
  /** 优雅关停（执行 `destroy` 后自退） */
  SHUTDOWN: 'plugin.shutdown',
} as const;

/**
 * 子进程 → 宿主 的**请求**方法名（`request.method`，方向与上面相反）。
 *
 * 复用同一套 `request`/`response` 帧（不建第三套 IPC）；为避免与宿主生成的 id 撞车，
 * 子进程请求 id 必须带 `PLUGIN_HOST_CHILD_ID_PREFIX`（见 `isPluginHostChildRequest`）。
 */
export const PLUGIN_HOST_CHILD_METHOD = {
  /** 写一条配置（`{key, value}`）；回包 `{ok, errors[]}`（宿主已校验并落盘） */
  CONFIG_SET: 'config.set',
} as const;

/** 子进程请求 id 前缀（宿主据此区分「回包」与「子进程发来的请求」） */
export const PLUGIN_HOST_CHILD_ID_PREFIX = 'child_';

/** 构造**子进程 → 宿主**的请求帧（id 自动带前缀；纯函数） */
export function buildPluginHostChildRequest(
  seq: number,
  method: string,
  params: Record<string, unknown> = {}
): Record<string, unknown> {
  return buildRequestFrame(
    `${PLUGIN_HOST_CHILD_ID_PREFIX}${seq}`,
    method,
    params
  );
}

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
  /** 配置快照（**仅在 `config` 能力已授权时**提供；缺省 ⇒ 子进程读不到任何配置） */
  config?: Record<string, unknown>;
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
  if (vars.config) env[PLUGIN_HOST_ENV_CONFIG] = JSON.stringify(vars.config);
  return env;
}

/**
 * 子进程侧读回**配置快照**。
 *
 * 缺省 / 非 JSON / 非对象 ⇒ `null`（**不臆造空配置**：调用方据此保留 no-op 实现，
 * 而不是把"读不到"当成"插件确实没配置"）。
 */
export function readPluginConfigSnapshot(
  env: NodeJS.ProcessEnv
): Record<string, unknown> | null {
  const raw = env[PLUGIN_HOST_ENV_CONFIG];
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
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

/**
 * 判定「这一帧是**子进程发来的请求**」（而不是对我方请求的回包）。
 *
 * 判据：`id` 是带前缀的字符串且带 `method`。回包只有 `{id, success, …}`、没有 `method`
 * ⇒ 两者不重叠；前缀再兜一层，防宿主 id 被伪造。
 */
export function isPluginHostChildRequest(
  frame: Record<string, unknown> | null | undefined
): frame is Record<string, unknown> & { id: string; method: string } {
  if (!frame) return false;
  const id = frame.id;
  if (typeof id !== 'string' || !id.startsWith(PLUGIN_HOST_CHILD_ID_PREFIX)) {
    return false;
  }
  return typeof frame.method === 'string' && frame.method.length > 0;
}

/**
 * 解析 `config.set` 请求的 `params`（非法 ⇒ `null`）。
 *
 * `key` 必须是非空字符串；`value` 允许任意 JSON 值（**含 `null`**：清空是合法语义），
 * 但 `params` 本身必须是对象且**含有** `value` 键（缺键 ≠ 设为 undefined）。
 */
export function parseChildConfigSet(
  frame: Record<string, unknown> | null | undefined
): { key: string; value: unknown } | null {
  if (!frame || frame.method !== PLUGIN_HOST_CHILD_METHOD.CONFIG_SET)
    return null;
  const params = frame.params;
  if (!params || typeof params !== 'object' || Array.isArray(params))
    return null;
  const p = params as Record<string, unknown>;
  if (typeof p.key !== 'string' || p.key.length === 0) return null;
  if (!('value' in p)) return null;
  return { key: p.key, value: p.value };
}
