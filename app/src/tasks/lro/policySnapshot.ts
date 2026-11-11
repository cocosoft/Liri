// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * policySnapshot —— 长程任务的**策略快照与恢复重放**（P2，2026-11-04，方案 §3.3）
 *
 * **要解决的问题**：长程任务（PDCA / 阶段链 / `/goal`）跨小时运行，期间用户可能改
 * 会话权限模式或全局默认档 —— 若不固定 `开始时的策略`，就会出现
 * "任务跑到一半，权限从 strict 被改成 bypass，后续步骤突然全自动放行"的行为漂移。
 *
 * **口径**：
 * 1. **随任务走**：任务启动时把生效策略快照进 checkpoint（`policySnapshot`），
 *    之后每次落 checkpoint 都带上同一份（不在运行中重新采样）；
 * 2. **恢复重放**：`resumeFromCheckpoint` 用快照重放，而不是读"当前会话设置"；
 * 3. **只收紧不放宽**（本次实现的关键约束）：重放取"快照 vs 当前"中**更保守**的一侧 ——
 *    快照更严 ⇒ 用快照（防中途被放宽）；当前更严 ⇒ 保留当前（用户后来收紧不该被快照顶回去）；
 *    工作区根只做**交集**（用户删掉的根不会被快照重新授予）；
 * 4. **缺快照**（旧任务 / 快照损坏）⇒ 保守降级为 `ask`，不阻断恢复。
 *
 * ⚠️ 模式"宽严"用**三档**粗分（restrictive / default / permissive），不是全序：
 * 5 档模式的语义轴不同（`auto` 自动放行、`dontAsk` 自动拒绝、`plan` 每步确认），
 * 强行排全序只会制造假精度。三档只回答一个问题：**这档会不会自动放行有副作用的调用**。
 */

import {
  normalizePermissionMode,
  type PermissionMode,
} from '@openliri/infra/permission';
import { resolveCommandPolicyVersion } from './commandPolicyVersion.js';

/** 快照结构版本（字段增删时递增；恢复侧只认当前版本） */
export const POLICY_SNAPSHOT_VERSION = 1;

/** 任务启动时从会话读到的原始值（不可信形态，交给本模块归一） */
export interface PolicySnapshotInput {
  /** 会话 `metadata.permission_mode`（缺省 ⇒ 跟随进程默认档） */
  permissionMode?: unknown;
  /** 会话 `metadata.approvalMode` */
  approvalMode?: unknown;
  /** 会话工作区根列表（首根 = 主工作区） */
  workspaceRoots?: unknown;
}

/** 落 checkpoint 的快照（全部字段已归一） */
export interface TaskPolicySnapshot {
  version: typeof POLICY_SNAPSHOT_VERSION;
  capturedAt: number;
  /**
   * 会话级权限模式覆盖。缺省 ⇒ 当时**没有**会话覆盖（跟随进程默认档）。
   * 进程默认档来自环境变量（进程内恒定）⇒ 不写也能保持不漂移。
   */
  permissionMode?: PermissionMode;
  /** 审批模式（归一为两值；任务启动时的默认档） */
  approvalMode: 'ask' | 'auto-local';
  /** 任务启动时的工作区根（后续重放只做交集） */
  workspaceRoots: string[];
  /** 命令判定策略版本（复用 LRO-13；用于解释"为什么旧结论失效"，不参与重放判定） */
  commandPolicyVersion: string;
}

/** 重放补丁（**只包含需要改动的字段**；全部缺省 ⇒ 无需改动） */
export interface PolicyReplayPatch {
  permissionMode?: PermissionMode;
  approvalMode?: 'ask' | 'auto-local';
  /**
   * **额外根**列表（不含主根；主根由 `workspacePath` 承载）。
   * 与当前额外根集合相同 ⇒ 不写；写成 `[]` 表示"取消全部额外根"（只留主根，属收紧）。
   */
  workspaceRoots?: string[];
}

/** 一次重放的结论（含解释，供日志/排障） */
export interface PolicyReplay {
  patch: PolicyReplayPatch;
  /** true = 没有可用快照，按 `ask` 保守降级 */
  degraded: boolean;
  /** 逐条说明做了什么/为什么不做（不写自由文本给用户，只进日志） */
  notes: string[];
}

/** 会自动放行有副作用调用的档（permissive 档） */
const AUTO_ALLOW_MODES: ReadonlySet<PermissionMode> = new Set([
  'auto',
  'bypass',
]);

/** 不会自动放行副作用调用的档（restrictive 档） */
const RESTRICTIVE_MODES: ReadonlySet<PermissionMode> = new Set([
  'dontAsk',
  'plan',
]);

/** 路径归一（去尾斜杠 + 小写；Windows 大小写不敏感，与 `mergeWorkspaceRoots` 同口径） */
function normalizePath(p: string): string {
  return p.replace(/[\\/]+$/, '').toLowerCase();
}

/** 归一 5 档模式（收缩前的旧值按别名归一）；非法/缺失 ⇒ undefined（不猜） */
function normalizeMode(raw: unknown): PermissionMode | undefined {
  return normalizePermissionMode(raw);
}

/** 归一审批模式（只认 `auto-local`，其余一律 `ask` —— 与 `ChatManager.getSessionApprovalMode` 同口径） */
function normalizeApprovalMode(raw: unknown): 'ask' | 'auto-local' {
  return raw === 'auto-local' ? 'auto-local' : 'ask';
}

/** 归一根列表（过滤脏值 + 按归一路径去重，保留原顺序） */
function normalizeRoots(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string' || item.trim() === '') continue;
    const key = normalizePath(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * 宽严三档：0 = restrictive，1 = default，2 = permissive。
 *
 * 缺失（无会话覆盖）按 1 处理：进程默认档通常是 `default`。
 */
function permissivenessTier(mode: PermissionMode | undefined): number {
  if (!mode) return 1;
  if (AUTO_ALLOW_MODES.has(mode)) return 2;
  if (RESTRICTIVE_MODES.has(mode)) return 0;
  return 1;
}

/**
 * 任务启动时采样快照（**唯一采集点**）。
 *
 * @param input 会话 metadata 的原始字段（可为脏值，内部归一）
 * @param now 注入时钟（测试用；缺省 `Date.now()`）
 */
export function capturePolicySnapshot(
  input: PolicySnapshotInput,
  now: number = Date.now()
): TaskPolicySnapshot {
  const permissionMode = normalizeMode(input.permissionMode);
  return {
    version: POLICY_SNAPSHOT_VERSION,
    capturedAt: now,
    ...(permissionMode ? { permissionMode } : {}),
    approvalMode: normalizeApprovalMode(input.approvalMode),
    workspaceRoots: normalizeRoots(input.workspaceRoots),
    commandPolicyVersion: resolveCommandPolicyVersion(),
  };
}

/**
 * 从 checkpoint 恢复快照（**不可信输入**：逐字段校验，任一关键字段不合法 ⇒ `undefined`）。
 *
 * 旧任务（无该字段）/结构损坏 ⇒ `undefined`，由调用方走"保守降级"。
 */
export function restorePolicySnapshot(
  raw: unknown
): TaskPolicySnapshot | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  if (record.version !== POLICY_SNAPSHOT_VERSION) return undefined;
  if (typeof record.capturedAt !== 'number') return undefined;
  if (typeof record.commandPolicyVersion !== 'string') return undefined;

  // 审批模式必须是两个合法值之一（缺失/脏值 ⇒ 整份快照作废，不猜「ask 也差不多」）
  const approvalMode = record.approvalMode;
  if (approvalMode !== 'ask' && approvalMode !== 'auto-local') return undefined;

  // 权限模式：允许缺失（= 当时无会话覆盖）；存在则必须合法
  let permissionMode: PermissionMode | undefined;
  if (record.permissionMode !== undefined) {
    permissionMode = normalizeMode(record.permissionMode);
    if (!permissionMode) return undefined;
  }

  return {
    version: POLICY_SNAPSHOT_VERSION,
    capturedAt: record.capturedAt,
    ...(permissionMode ? { permissionMode } : {}),
    approvalMode,
    workspaceRoots: normalizeRoots(record.workspaceRoots),
    commandPolicyVersion: record.commandPolicyVersion,
  };
}

/**
 * 计算"快照 ⇒ 当前会话"的重放补丁（纯函数，**只收紧不放宽**）。
 *
 * 判定细则：
 * - 权限模式：取宽严档更低者；同档取快照（保持任务启动时的姿态）；快照比当前更宽 ⇒ 不写。
 *   当前无会话覆盖、快照属 permissive ⇒ 不写（不把进程默认档抬成自动放行）。
 * - 审批模式：`auto-local` 是放宽档 ⇒ 只有"快照与当前都是 `auto-local`"才保留，否则 `ask`。
 * - 工作区根：只改**额外根**（主根由 `workspacePath` 承载）——取快照 ∩ 当前，**不新增**；
 *   与当前额外根不同才写（可写 `[]` = 取消全部额外根，属收紧）。
 * - 无快照（`snapshot === undefined`）⇒ 保守降级：审批档 `ask`；权限模式仅当当前更宽时才压到 `ask`。
 */
export function resolvePolicyReplay(args: {
  snapshot: TaskPolicySnapshot | undefined;
  current: PolicySnapshotInput;
}): PolicyReplay {
  const notes: string[] = [];
  const patch: PolicyReplayPatch = {};
  const currentMode = normalizeMode(args.current.permissionMode);
  const currentApproval = normalizeApprovalMode(args.current.approvalMode);

  if (!args.snapshot) {
    // 旧任务 / 快照损坏 ⇒ 保守降级（方案 §6「缺快照保守降级 ask，不阻断」）
    if (permissivenessTier(currentMode) > 0) patch.permissionMode = 'plan';
    else notes.push('degraded:keep-stricter-current-mode');
    if (currentApproval !== 'ask') patch.approvalMode = 'ask';
    notes.push('degraded:no-snapshot');
    return { patch, degraded: true, notes };
  }

  const snapshot = args.snapshot;
  if (snapshot.permissionMode) {
    const snapshotTier = permissivenessTier(snapshot.permissionMode);
    const currentTier = permissivenessTier(currentMode);
    if (snapshotTier <= currentTier) {
      if (snapshot.permissionMode !== currentMode) {
        patch.permissionMode = snapshot.permissionMode;
        notes.push(`permission-mode:snapshot(${snapshot.permissionMode})`);
      }
    } else {
      notes.push(
        `permission-mode:keep-current(${currentMode ?? 'default'})>snapshot(${snapshot.permissionMode})`
      );
    }
  }

  const chosenApproval =
    snapshot.approvalMode === 'auto-local' && currentApproval === 'auto-local'
      ? 'auto-local'
      : 'ask';
  if (chosenApproval !== currentApproval) {
    patch.approvalMode = chosenApproval;
    notes.push(`approval-mode:${chosenApproval}`);
  }

  const currentRoots = normalizeRoots(args.current.workspaceRoots);
  if (snapshot.workspaceRoots.length > 0 && currentRoots.length > 0) {
    const currentKeys = new Set(currentRoots.map(normalizePath));
    // 主根由 `workspacePath` 单独承载 ⇒ 写回时只改"额外根"，不把主根当额外根重复授予
    const primaryKey = normalizePath(currentRoots[0]);
    const currentExtras = currentRoots.slice(1);
    const nextExtras = snapshot.workspaceRoots.filter(
      (r) =>
        currentKeys.has(normalizePath(r)) && normalizePath(r) !== primaryKey
    );
    const sameExtras =
      nextExtras.length === currentExtras.length &&
      nextExtras.every(
        (r, i) => normalizePath(r) === normalizePath(currentExtras[i])
      );
    if (!sameExtras) {
      patch.workspaceRoots = nextExtras;
      notes.push(`roots:extras(${nextExtras.length})`);
    }
  }

  return { patch, degraded: false, notes };
}
