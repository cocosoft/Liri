// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * ApprovedCommandRegistry — 已批准命令放行缓存（工具执行审批链路 P0-3/P0-6）
 *
 * 职责：用户在审批卡片批准危险命令后，把该命令（按 sessionId + 规范化 hash）
 * 记录到短 TTL 缓存；BashTool 执行前查询命中则跳过安全拦截层。
 *
 * 安全约束（评审缺口 B/D / S1-1）：
 * - session 隔离：Map<sessionId, Map<hash, entry>>，跨会话不共享
 * - TTL 5min：批准仅作用于短窗口，防"批准一次永久放行"
 * - hash 精确匹配：规范化命令（引号感知压缩空白、**保留大小写**）→ **SHA-256**（前 128 bit），
 *   防 LLM 重发时改文本导致匹配失败（防张冠李戴/防篡改）
 * - 作用域绑定（S1-1）：批准记录绑定执行作用域摘要（cwd / 调用方 env / 平台），
 *   执行端传入 scope 时必须一致，否则视为未批准（fail-closed）
 */
import { createHash } from 'crypto';
import { getLogger } from '@modules/monitoring';
import { feature } from '@modules/core';
const logger = getLogger('permission:approvedCommands');

/** 批准记录默认 TTL（毫秒）— P0-1: 60s → 5min，匹配"批准→LLM 续跑"真实耗时（实测 75–131s） */
const APPROVED_COMMAND_TTL_MS = 300_000;

/** 环境变量：批准放行缓存 TTL（毫秒） */
const APPROVAL_TTL_ENV = 'PERMISSION_APPROVAL_TTL_MS';

/** 定时清理间隔（毫秒） */
const APPROVED_COMMAND_CLEANUP_INTERVAL_MS = 30_000;

/**
 * 命令规范化：**引号感知**压缩空白 + 运算符贴边；**保留大小写**。
 *
 * 与 BashTool 拦截前的原始命令在同一规范化函数下计算 hash，保证两端一致。
 *
 * ⚠️ 第九轮审查 §十-3（2026-10-09，缺陷 #3）：原实现 `.replace(/['"]/g,'"')` + `.replace(/\s+/g,' ')`
 * + `.toLowerCase()` 会把**语义不同**的命令映射到**同一授权标识**：
 * - `.toLowerCase()`：POSIX 下 `RM -rf A` 与 `rm -rf A` 语义不同（前者多不可执行）；
 * - 全局压缩空白：**引号内空白是语义**（`echo "a  b"` ≠ `echo "a b"`）⇒ 批准其一即放行另一。
 * ⇒ 现仅压缩**引号外**空白，并**不再转小写**（宁可多弹一次审批，不放行语义漂移）。
 */
export function normalizeCommand(command: string): string {
  let out = '';
  let quote: string | null = null;
  let pendingSpace = false;
  const OPS = '|&;<>()';
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      out += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      if (pendingSpace && out) out += ' ';
      pendingSpace = false;
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      pendingSpace = true;
      continue;
    }
    if (OPS.includes(ch)) {
      // 运算符贴边：去前导空白，且不追加后置空白
      pendingSpace = false;
      out += ch;
      continue;
    }
    if (pendingSpace && out) out += ' ';
    pendingSpace = false;
    out += ch;
  }
  return out.trim();
}

/** S1-1（2026-10-11）：审批绑定作用域 —— 同一命令在不同执行上下文中**不得**复用同一次批准。 */
export interface ApprovalScope {
  /** 平台（`process.platform`），进程内恒定 */
  platform?: string;
  /** 执行目录（工具参数 cwd，或上下文 options.cwd） */
  cwd?: string;
  /** 调用方 env 摘要（见 `hashEnvForApproval`；**只存摘要，不存明文**） */
  envDigest?: string;
  /** 沙箱级别（预留给沙箱策略；未接入时省略） */
  sandboxLevel?: string;
}

/** S1-1：审批快照 —— 记录"批准时用户看到的命令"与"实际将执行的命令"及其改写原因。 */
export interface ApprovalSnapshot {
  /** 模型/用户原始命令（预处理之前） */
  originalCommand: string;
  /** 规范化（`normalizeCommand`）后的命令 */
  normalizedCommand: string;
  /** 预处理改写项（如 `/tmp → %TEMP%`），空数组表示无改写 */
  rewrites: string[];
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * 命令 hash（S1-1，2026-10-11：改为 **SHA-256**）。
 *
 * 原实现为 djb2（`h<<5 + h + c`，32 位非密码学哈希）：既易构造碰撞，又不满足
 * "安全授权身份绑定"的最低强度要求（与第九轮审查 §3.3 的短 ID 问题同源）。
 * 现取 SHA-256 前 32 位十六进制（128 bit）。
 */
export function hashCommand(command: string): string {
  return sha256Hex(normalizeCommand(command)).slice(0, 32);
}

/**
 * S1-1：调用方 env 摘要 —— 对**已清洗**的调用方 env 取 SHA-256（前 32 位 hex）。
 *
 * 只记录摘要、不记录明文（避免 env 中的凭据进入缓存/日志）；键排序后 `k=v` 拼接
 * ⇒ 同内容不同插入顺序得到同一摘要。空对象/undefined ⇒ `undefined`（无 env 约束）。
 */
export function hashEnvForApproval(
  env: Record<string, string | undefined> | undefined
): string | undefined {
  if (!env) return undefined;
  const keys = Object.keys(env).sort();
  if (keys.length === 0) return undefined;
  return sha256Hex(
    keys.map((k) => `${k}=${env[k] ?? ''}`).join('\u0000')
  ).slice(0, 32);
}

/** S1-1：作用域摘要（字段序固定 ⇒ 可稳定比较）；无任何字段时返回 `undefined`。 */
export function computeScopeDigest(
  scope: ApprovalScope | undefined
): string | undefined {
  if (!scope) return undefined;
  const parts: string[] = [];
  if (scope.platform !== undefined) parts.push(`platform=${scope.platform}`);
  if (scope.cwd !== undefined) parts.push(`cwd=${scope.cwd}`);
  if (scope.envDigest !== undefined) parts.push(`env=${scope.envDigest}`);
  if (scope.sandboxLevel !== undefined)
    parts.push(`sandbox=${scope.sandboxLevel}`);
  if (parts.length === 0) return undefined;
  return sha256Hex(parts.join('\u0000')).slice(0, 32);
}

/**
 * 命令执行 hash — 提交审批与执行查询的统一入口（P0-2）。
 *
 * 与 BashTool.preprocessWindowsCommand 的命令文本转换保持一致：
 * Windows 下 `/tmp` → `%TEMP%`、`/dev/null` → `NUL`，再规范化 + hash。
 * 幂等：对已预处理的命令再次调用结果不变（`%TEMP%`/`NUL` 不再含 `/tmp`/`/dev/null`）。
 *
 * 目的：消除双端 hash 不一致——
 * - 提交端（PermissionChecker/ChatManager）：对 LLM 原始命令调用本函数
 * - 执行端（BashTool）：对 Windows 预处理后的命令调用本函数
 * 两端结果一致，批准后重发同一命令可稳定命中放行缓存。
 *
 * S1-1：作用域（cwd/env/平台）**不并入本 hash**，而是作为独立条件由
 * `ApprovedCommandRegistry.isApproved(sessionId, hash, scope)` 校验 —— 这样
 * "提交审批/跳过 ask 卡"等仅知命令的调用点零改动，而执行端可要求作用域一致。
 */
export function hashCommandForExecution(command: string): string {
  let c = command;
  if (process.platform === 'win32') {
    c = c.replace(/\/tmp\b/g, '%TEMP%').replace(/\/dev\/null\b/g, 'NUL');
  }
  return hashCommand(c);
}

/** S1-1：审批记录（导出以便审计/测试读取） */
export interface ApprovalEntry {
  hash: string;
  expiresAt: number;
  /** P0-3: 批准命令的命令名（首个 token），供命令名级放行 */
  baseCommand?: string;
  /** S1-1: 绑定的执行作用域摘要（批准时记录；执行时若给 scope 必须与之一致） */
  scopeDigest?: string;
  /**
   * S1-1: 能力摘要（**预留**，供 S2-5 能力级授权；当前仅记录、不参与判定）。
   *
   * ⚠️ **边界（TG-1 / 2026-10-12 裁断）**：本字段属**权限域**（「特定会话 + 精确命令语义」的
   * **执行授权指纹**），**严禁**并入工具契约 `utils/toolContract/Tool.ts` 的
   * `ToolCapabilityDescriptor`（**能力域**：工具的静态固有属性）—— 二者语义正交（CS01 / R02-002）。
   */
  capabilityDigest?: string;
  /** S1-1: 审批快照（原始命令 / 规范化命令 / 改写项） */
  snapshot?: ApprovalSnapshot;
}

/**
 * P0-3: 命令名级放行禁用的危险命令名。
 * 危险命令的参数漂移不得放行（如批准 `rm -rf A` 后 `rm -rf B` 必须精确 hash 命中）。
 * 来源：BashTool.DANGEROUS_COMMANDS 的命令名维度 + Windows 破坏性命令补充。
 */
const DANGEROUS_BASE_NAMES = new Set([
  'rm',
  'del',
  'erase',
  'rd',
  'rmdir',
  'format',
  'shutdown',
  'reboot',
  'poweroff',
  'sudo',
  'su',
  'chmod',
  'chown',
  'mkfs',
  'fdisk',
  'dd',
  'kill',
  'killall',
  'pkill',
  'taskkill',
  'reg',
  'diskpart',
  'mount',
  'umount',
  'useradd',
  'userdel',
  'passwd',
  'chroot',
  'init',
]);

/** 提取命令名（首个 token，已规范化），空命令返回空串 */
export function getBaseCommand(command: string): string {
  return normalizeCommand(command).split(/\s+/)[0] || '';
}

export class ApprovedCommandRegistry {
  private store = new Map<string, Map<string, ApprovalEntry>>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private ttlMs: number;

  constructor(ttlMs: number = APPROVED_COMMAND_TTL_MS, autoCleanup = true) {
    this.ttlMs = ttlMs;
    if (autoCleanup) {
      this.cleanupTimer = setInterval(
        () => this.cleanup(),
        APPROVED_COMMAND_CLEANUP_INTERVAL_MS
      );
      // 避免定时器阻止进程退出（测试环境）
      this.cleanupTimer.unref?.();
    }
  }

  /**
   * 记录一条已批准命令（幂等）；传入 command 时记录命令名供命令名级放行（P0-3）。
   *
   * S1-1：`extras` 可携带执行作用域（`scope`，落为 `scopeDigest`）、审批快照
   * （`snapshot`）与能力摘要（`capabilityDigest`，预留）。不传即为既有语义。
   */
  approve(
    sessionId: string,
    hash: string,
    command?: string,
    extras?: {
      scope?: ApprovalScope;
      snapshot?: ApprovalSnapshot;
      capabilityDigest?: string;
    }
  ): void {
    if (!sessionId || !hash) return;
    let sessionMap = this.store.get(sessionId);
    if (!sessionMap) {
      sessionMap = new Map();
      this.store.set(sessionId, sessionMap);
    }
    const scopeDigest = computeScopeDigest(extras?.scope);
    sessionMap.set(hash, {
      hash,
      expiresAt: Date.now() + this.ttlMs,
      baseCommand: command ? getBaseCommand(command) : undefined,
      scopeDigest,
      capabilityDigest: extras?.capabilityDigest,
      snapshot: extras?.snapshot,
    });
    logger.info('危险命令已批准（放行缓存写入）', {
      sessionId,
      hash,
      scopeBound: scopeDigest !== undefined,
      hasSnapshot: !!extras?.snapshot,
    });
  }

  /**
   * 命令是否已批准（session 隔离 + 未过期 + 精确 hash 匹配）。
   *
   * S1-1：传入 `scope` 时**还要求**记录中的 `scopeDigest` 与之一致
   * （同一命令在不同 cwd/env/平台下不得复用同一次批准；记录缺失作用域即视为不匹配
   * —— fail-closed）。不传 `scope` 时保持既有语义（供"是否已批准"的快速判定，
   * 如 ChatManager 跳过 ask 卡片）。
   */
  isApproved(sessionId: string, hash: string, scope?: ApprovalScope): boolean {
    if (!sessionId || !hash) return false;
    const sessionMap = this.store.get(sessionId);
    if (!sessionMap) return false;
    const entry = sessionMap.get(hash);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      sessionMap.delete(hash);
      return false;
    }
    const requested = computeScopeDigest(scope);
    if (requested !== undefined && entry.scopeDigest !== requested) {
      return false;
    }
    return true;
  }

  /** S1-1：读取审批记录（供审计/测试；返回浅拷贝，避免外部改动内部状态） */
  getApprovalEntry(
    sessionId: string,
    hash: string
  ): Readonly<ApprovalEntry> | undefined {
    const entry = this.store.get(sessionId)?.get(hash);
    if (!entry) return undefined;
    return {
      ...entry,
      snapshot: entry.snapshot
        ? { ...entry.snapshot, rewrites: [...entry.snapshot.rewrites] }
        : undefined,
    };
  }

  /**
   * P0-3: 命令名级放行 — 同 session 内批准过该命令名且该命令名非危险命令。
   *
   * 用途：仅用于 ChatManager 跳过 ask 弹卡（避免 LLM 重发文本漂移导致重复弹卡）；
   * BashTool 安全拦截层仍作为兜底执行（危险命令参数漂移会被安全层拦截）。
   * 危险命令必须精确 hash 命中（isApproved），防止 `rm -rf A` 放行 `rm -rf B`。
   */
  isCommandNameApproved(sessionId: string, command: string): boolean {
    // A5（2026-10-09）：严格模式（灰度开关 BASH_APPROVAL_STRICT，默认关）下禁用
    // 命令名级放行 —— 仅保留精确 hash 命中（isApproved），消除"同名不同参"漂移放行。
    if (feature('BASH_APPROVAL_STRICT')) return false;
    if (!sessionId || !command) return false;
    const base = getBaseCommand(command);
    if (!base || DANGEROUS_BASE_NAMES.has(base)) return false;
    const sessionMap = this.store.get(sessionId);
    if (!sessionMap) return false;
    const now = Date.now();
    for (const entry of sessionMap.values()) {
      if (entry.baseCommand === base && now <= entry.expiresAt) {
        // O1-B3（2026-10-09，触发条件补全方案 §三-O1）：**命令名级放行命中**观测（仅日志，
        // 零行为变更）。用途：使 `BASH_APPROVAL_STRICT` 的触发条件「同名不同参被命令名级
        // 放行」可读（见 `.trae/specs/default-off-switches-review-gates.md`）。
        logger.debug('命令名级放行命中', { sessionId, baseCommand: base });
        return true;
      }
    }
    return false;
  }

  /** 清除某会话的全部批准（会话切换/结束时可调用） */
  clearSession(sessionId: string): void {
    this.store.delete(sessionId);
  }

  /** 清理过期条目 */
  cleanup(): void {
    const now = Date.now();
    for (const [sessionId, sessionMap] of this.store) {
      for (const [hash, entry] of sessionMap) {
        if (now > entry.expiresAt) sessionMap.delete(hash);
      }
      if (sessionMap.size === 0) this.store.delete(sessionId);
    }
  }

  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.store.clear();
  }
}

let _instance: ApprovedCommandRegistry | null = null;

/** 解析放行缓存 TTL：优先环境变量 PERMISSION_APPROVAL_TTL_MS，否则默认 5 分钟（P0-1） */
function resolveApprovalTtl(): number {
  const raw = process.env[APPROVAL_TTL_ENV];
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return APPROVED_COMMAND_TTL_MS;
}

/** 全局单例 */
export function getApprovedCommandRegistry(): ApprovedCommandRegistry {
  if (!_instance) {
    _instance = new ApprovedCommandRegistry(resolveApprovalTtl());
  }
  return _instance;
}

/**
 * 工具调用级审批键（N1，两阶段执行）
 *
 * 用于非 bash 类工具（如 media:delete）的审批放行：
 * - bash/shell/command：沿用 input.command 作为键（与既有命令级审批一致，零行为变化）
 * - 其他工具：`toolName:稳定JSON`（键排序，防 LLM 重发时参数顺序漂移导致哈希不匹配）
 */
export function toolCallApprovalKey(
  toolName: string,
  input: Record<string, unknown>
): string {
  if (typeof input.command === 'string' && input.command) {
    return input.command;
  }
  const stable: Record<string, unknown> = {};
  for (const key of Object.keys(input).sort()) {
    stable[key] = input[key];
  }
  return `${toolName}:${JSON.stringify(stable)}`;
}

/**
 * 工具调用是否已批准（session 隔离 + TTL）
 *
 * 与审批提交端 `_submitToolApproval` 使用同一键（toolCallApprovalKey），
 * 用户批准后 LLM 重发同一调用即可命中放行。
 */
export function isToolCallApproved(
  sessionId: string,
  toolName: string,
  input: Record<string, unknown>
): boolean {
  const key = toolCallApprovalKey(toolName, input);
  return getApprovedCommandRegistry().isApproved(
    sessionId,
    hashCommandForExecution(key)
  );
}
