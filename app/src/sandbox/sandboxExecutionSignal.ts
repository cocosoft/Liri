// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * sandboxExecutionSignal — 本次执行的**沙箱上下文信号**（PR-3a，2026-10-23）
 *
 * 背景：审批层此前拿不到"这次到底会不会在沙箱里执行"的信号（`ToolUseContext` 无该字段，
 * 台账 Q-29）⇒ 设计 §3.9 的统一判定链「沙箱豁免」无从落地，且 `SandboxIntegration` 只能用
 * **工具名包含匹配**猜"要不要沙箱"（CS02 违规，Q-26）。
 *
 * 本模块只回答一个问题：**基于配置与平台事实，本次执行的沙箱模式与权限位是什么**。
 * - 输入是**执行入口**的事实（`sandbox.enabled` / `sandbox.landlock.*` / 平台 / 适配器提示）；
 * - 不读工具名、不猜风险（CS02）；
 * - 无隔离证据 ⇒ `mode: 'none'`（fail-closed，与 §3.9.4 S1 同口径）。
 *
 * ⚠️ PR-3a **不改变**任何 allow / ask / deny 判定：信号仅注入 `ToolUseContext.sandbox`
 * 并在审批卡 metadata 里留证；豁免判定在 PR-3b 的 `resolveToolDecision()` 统一实现。
 */

import { configManager } from '@modules/config';
import type {
  SandboxExecutionMode,
  SandboxExecutionSignal,
  SandboxPermissionLevel,
  ToolSandboxLevel,
} from '@modules/utils/toolContract/Tool';

import { readLandlockConfig } from './landlock/config';
import { LandlockDetector } from './landlock/LandlockDetector';
import {
  hasIsolatedFileIo,
  resolveFileIoExecutionMode,
  resolveWorkspacePathMaps,
} from './workspaceIsolation';

/**
 * 沙箱默认权限位（2026-10-23 用户拍板：`standard`）。
 *
 * - `full`（旧默认）= READ + WRITE + **EXECUTE**；
 * - `standard`（现默认）= READ + WRITE（**不含 EXECUTE**）；
 * - `readonly` = READ。
 *
 * 收窄理由（Q-30）：默认 `full` 时"沙箱内放行"等于允许任意执行 ⇒ 隔离形同虚设。
 */
export const DEFAULT_SANDBOX_PERMISSION_LEVEL: SandboxPermissionLevel =
  'standard';

/** 合法权限位取值（与 HTTP handler 的白名单同域） */
export const SANDBOX_PERMISSION_LEVELS: readonly SandboxPermissionLevel[] = [
  'readonly',
  'standard',
  'full',
];

/**
 * 纯函数：把配置/环境原值规整为权限位。
 *
 * 未配置或取值非法 ⇒ **默认 `standard`**（不是 `full`，避免"写错一个字符就放宽到可执行"）。
 */
export function resolveSandboxPermissionLevel(
  configured?: unknown,
  envDefault?: unknown
): SandboxPermissionLevel {
  const raw =
    typeof configured === 'string' && configured.trim() !== ''
      ? configured
      : envDefault;
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return (SANDBOX_PERMISSION_LEVELS as readonly string[]).includes(value)
    ? (value as SandboxPermissionLevel)
    : DEFAULT_SANDBOX_PERMISSION_LEVEL;
}

/** 读当前生效权限位：`config.json sandbox.permissionLevel` > 环境变量 > 默认 `standard` */
export function readSandboxPermissionLevel(): SandboxPermissionLevel {
  return resolveSandboxPermissionLevel(
    configManager.getValue<string>('sandbox.permissionLevel'),
    configManager.env(
      'PERMISSION_SANDBOX_DEFAULT',
      DEFAULT_SANDBOX_PERMISSION_LEVEL
    )
  );
}

/** 沙箱总开关（`config.json sandbox.enabled`，未配置 ⇒ 启用） */
export function readSandboxEnabled(): boolean {
  return configManager.getValue<boolean>('sandbox.enabled') ?? true;
}

export interface ResolveSandboxSignalParams {
  /** 覆盖沙箱总开关（缺省读配置） */
  enabled?: boolean;
  /** 覆盖 Landlock 总开关（缺省读 `sandbox.landlock.enabled`） */
  landlockEnabled?: boolean;
  /** 覆盖平台（缺省 `process.platform`；供单测注入） */
  platform?: NodeJS.Platform;
  /**
   * 由**真正决定执行环境**的入口提供的模式提示（bash 的 landlock gate、容器/SSH/PTY 适配器）。
   * 提供 ⇒ 直接采用（沙箱关闭时仍归 `none`）。
   */
  modeHint?: SandboxExecutionMode;
  /** 覆盖权限位（缺省读配置） */
  permissionLevel?: SandboxPermissionLevel;
  /**
   * 覆盖 **Landlock 能力证据**（缺省读 `LandlockDetector` 的**已缓存**探测结果）。
   *
   * PR-3c（2026-10-23）：S1 要求「隔离**且探测通过**」—— 配置里写了 landlock 不等于真受限
   * （WSL2 / 缺 helper 时会回退 plain）。未探测完成 ⇒ 按 `false` 处理（fail-closed）。
   */
  landlockAvailable?: boolean;
  /** 覆盖**文件 IO 隔离证据**（缺省读默认工作区适配器形态，见 `workspaceIsolation`） */
  fileIoIsolated?: boolean;
  /**
   * 覆盖**已挂载的宿主根**（§12.15；缺省读默认工作区的 `fileIoMounts()`）。
   * 供沙箱豁免 S4b 校验"工具实际落点根是否被挂载"。
   */
  fileIoRoots?: string[];
}

/**
 * Landlock 能力是否**已被证实**可用（同步、零副作用读取缓存）。
 *
 * 首次调用会**异步触发**一次探测（结果进程内缓存）；本次仍按"未证实"返回 `false`，
 * 避免用"计划要走 Landlock"冒充隔离证据。
 */
function hasLandlockEvidence(): boolean {
  const cached = LandlockDetector.getCached();
  if (cached) return cached.available;
  void LandlockDetector.detect();
  return false;
}

/**
 * 解析本次执行的沙箱信号。
 *
 * 判定顺序：沙箱关闭 ⇒ `none`；有执行入口给的 `modeHint` ⇒ 采用；否则
 * 「Landlock 开关开 + Linux + **能力探测通过**」⇒ `landlock`；**其余一律 `none`**（无隔离证据）。
 */
export function resolveSandboxExecutionSignal(
  params: ResolveSandboxSignalParams = {}
): SandboxExecutionSignal {
  const enabled = params.enabled ?? readSandboxEnabled();
  const permissionLevel =
    params.permissionLevel ?? readSandboxPermissionLevel();
  const fileIoIsolated = params.fileIoIsolated ?? hasIsolatedFileIo();
  const fileIoRoots =
    params.fileIoRoots ??
    resolveWorkspacePathMaps().map((mount) => mount.hostRoot);
  if (!enabled)
    return { mode: 'none', permissionLevel, fileIoIsolated, fileIoRoots };
  if (params.modeHint)
    return {
      mode: params.modeHint,
      permissionLevel,
      fileIoIsolated,
      fileIoRoots,
    };

  const landlockEnabled =
    params.landlockEnabled ?? readLandlockConfig().enabled;
  const platform = params.platform ?? process.platform;
  const available = params.landlockAvailable ?? hasLandlockEvidence();
  const mode: SandboxExecutionMode =
    landlockEnabled && platform === 'linux' && available ? 'landlock' : 'none';
  return { mode, permissionLevel, fileIoIsolated, fileIoRoots };
}

/**
 * 文件类工具（`sandboxLevel === 'file-io'`）的 **modeHint**（2026-10-23）。
 *
 * 为什么需要它：`mode` 的缺省推导只看 Landlock（只包命令子进程）；文件工具在隔离
 * 工作区里时，真正的执行环境是**容器 / 远端**，否则 Landlock 未开时 `mode='none'`
 * 会把"文件 IO 确实隔离"的调用也挡在豁免之外。
 *
 * @returns 仅当该工具声明 `file-io` **且**工作区有可用挂载映射时给出 `container`/`ssh`；
 *          其余（只读/执行类工具、本地工作区、无映射）⇒ `undefined`（不表态）
 */
export function resolveFileIoToolModeHint(
  sandboxLevel?: ToolSandboxLevel
): SandboxExecutionMode | undefined {
  if (sandboxLevel !== 'file-io') return undefined;
  return resolveFileIoExecutionMode();
}

/**
 * 沙箱信号是否**可据以豁免**（PR-3b 起：`PermissionChecker` 的沙箱豁免步在判定前读它）。
 *
 * 口径与 §3.9.4 S1 一致：`mode === 'none'` 或字段缺失 ⇒ `false`（fail-closed）。
 */
export function isSandboxSignalUsable(
  signal: SandboxExecutionSignal | undefined
): signal is SandboxExecutionSignal {
  return signal !== undefined && signal.mode !== 'none';
}
