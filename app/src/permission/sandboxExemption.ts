// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * sandboxExemption — 「沙箱内放行」的**唯一判定点**（PR-3b，2026-10-23；设计 §3.9.4）
 *
 * 定位：统一判定链（§3.9.3）的**第 4 步** —— 只能把"风险默认的 ask"变成 allow，
 * 永不越过 deny（第 1/2 步）与用户显式 ask（第 3 步）。调用点在
 * `PermissionChecker._handleDefaultAsk()`（那里才是风险默认档）。
 *
 * 五条硬前提（缺一即**不豁免**，回到风险默认；**禁止**"降级为放行"）：
 * - **S1 隔离可证**：`ToolUseContext.sandbox.mode !== 'none'`（缺失 = 无证据 ⇒ 不豁免）；
 * - **S2 能力匹配**：工具**声明**的 `sandboxLevel` 覆盖本次操作（未声明 ⇒ 不豁免）；
 * - **S3 权限位覆盖**：声明还需覆盖操作类型（写需 `standard`、执行需 `full`）；
 * - **S4 范围匹配**：路径参数全部在工作区内（含符号链接展开）；
 * - **S5 不可豁免项**：deny/危险命令/凭据/系统目录 —— 由上游硬拦截层先返回，本模块不重复判定。
 *
 * 为什么 `SHELL` 一律不豁免：S4 要求"联网命令须在端口白名单内"，而当前无法从命令串可靠证明
 * （Landlock 端口策略在 `landlock/types.ts` 侧仅是白名单形态）⇒ **fail-closed**。
 *
 * ⚠️ 本模块是**纯函数**（除 `findWorkspaceEscape` 的 `realpath` 依赖），零状态、零审计；
 * 审计 `approval:sandbox` 由调用方写。
 */

import type {
  SandboxExecutionSignal,
  ToolSandboxLevel,
} from '@modules/utils/toolContract/Tool';
import { PATH_ARG_KEYS } from '@modules/utils/toolContract/pathArgs';
import { findWorkspaceEscape } from '@modules/utils/toolContract/pathBoundary';

import { RiskClass } from './types/RiskClass';

/** 沙箱能力档位排序（`ToolSandboxLevel` 的覆盖关系） */
const CAPABILITY_RANK: Record<ToolSandboxLevel, number> = {
  none: 0,
  readonly: 1,
  'file-io': 2,
  execution: 3,
};

/** 权限位排序（`SandboxPermissionLevel`） */
const PERMISSION_RANK = {
  readonly: 0,
  standard: 1,
  full: 2,
} as const;

/** 不豁免的原因码（可枚举、可审计，不用自由文本做判据 —— CS02） */
export type SandboxExemptionDenialReason =
  | 'no-signal'
  | 'no-isolation'
  | 'risk-not-exemptable'
  | 'shell-unprovable'
  | 'file-io-not-isolated'
  | 'capability-undeclared'
  | 'capability-insufficient'
  | 'permission-insufficient'
  | 'no-workspace'
  | 'no-path-arg'
  | 'outside-workspace';

export type SandboxExemptionResult =
  | { exempt: true; reason: 'sandbox-isolated' }
  | { exempt: false; reason: SandboxExemptionDenialReason };

export interface SandboxExemptionInput {
  /** 执行入口注入的沙箱信号（缺失 ⇒ 不豁免） */
  signal?: SandboxExecutionSignal;
  risk: RiskClass;
  /** 工具**声明**的沙箱能力（缺省/`none` ⇒ 不豁免） */
  sandboxLevel?: ToolSandboxLevel;
  input: Record<string, unknown>;
  /** 会话工作区边界（缺省 ⇒ 不豁免） */
  workspacePath?: string;
}

/** 本次风险级所需的**最低**沙箱能力；`null` = 该风险级不可豁免 */
function requiredCapability(risk: RiskClass): ToolSandboxLevel | null {
  switch (risk) {
    case RiskClass.READ:
    case RiskClass.DISCUSS:
      return 'readonly';
    case RiskClass.WRITE_LOCAL:
      return 'file-io';
    case RiskClass.SHELL:
      return 'execution';
    case RiskClass.EXTERNAL:
    case RiskClass.UNDECLARED:
    default:
      // 外部副作用 / 未声明：不提供沙箱豁免（与 §3.9.3「deny > 显式 ask > …」同口径）
      return null;
  }
}

/** 所需最低权限位 */
function requiredPermission(
  capability: ToolSandboxLevel
): keyof typeof PERMISSION_RANK {
  if (capability === 'execution') return 'full';
  if (capability === 'file-io') return 'standard';
  return 'readonly';
}

const deny = (
  reason: SandboxExemptionDenialReason
): SandboxExemptionResult => ({
  exempt: false,
  reason,
});

/**
 * 判定本次调用能否因"沙箱内执行"而免人工审批（S1–S4）。
 *
 * 返回 `{ exempt: true }` 时调用方才可产出 allow；任何一条不满足都返回具体原因码。
 */
export function resolveSandboxExemption(
  params: SandboxExemptionInput
): SandboxExemptionResult {
  // S1：隔离可证（缺失/`none` 都视为"未沙箱"）
  const signal = params.signal;
  if (!signal) return deny('no-signal');
  if (signal.mode === 'none') return deny('no-isolation');

  // S4 前置：命令类无法证明网络/端口范围 ⇒ 不豁免（fail-closed）
  if (params.risk === RiskClass.SHELL) return deny('shell-unprovable');

  const required = requiredCapability(params.risk);
  if (!required) return deny('risk-not-exemptable');

  // S1b（方案 A，2026-10-23）：**文件类**能力额外要求"文件 IO 可证落在隔离环境内"。
  // `mode` 只证明环境具备隔离能力（Landlock 仅包住命令子进程），不证明宿主 `node:fs` 被隔离 ⇒
  // 缺 `fileIoIsolated` 一律不豁免（防"补个 file-io 声明就静默放行写操作"）。
  if (required !== 'execution' && signal.fileIoIsolated !== true) {
    return deny('file-io-not-isolated');
  }

  // S2：能力匹配（必须由工具显式声明沙箱能力）
  const declared = params.sandboxLevel;
  if (!declared || declared === 'none') return deny('capability-undeclared');
  if (CAPABILITY_RANK[declared] < CAPABILITY_RANK[required]) {
    return deny('capability-insufficient');
  }

  // S3：权限位覆盖
  if (
    PERMISSION_RANK[signal.permissionLevel] <
    PERMISSION_RANK[requiredPermission(required)]
  ) {
    return deny('permission-insufficient');
  }

  // S4：范围匹配（工作区边界 + 至少一个路径参数 + 不得越界）
  const workspace = params.workspacePath;
  if (!workspace) return deny('no-workspace');
  const hasPathArg = PATH_ARG_KEYS.some(
    (key) =>
      typeof params.input[key] === 'string' &&
      (params.input[key] as string).trim() !== ''
  );
  if (!hasPathArg) return deny('no-path-arg');
  if (findWorkspaceEscape(workspace, params.input)) {
    return deny('outside-workspace');
  }

  return { exempt: true, reason: 'sandbox-isolated' };
}
