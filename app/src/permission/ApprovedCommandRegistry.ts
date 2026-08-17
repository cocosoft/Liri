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
 * 安全约束（评审缺口 B/D）：
 * - session 隔离：Map<sessionId, Map<hash, entry>>，跨会话不共享
 * - TTL 60s：批准仅作用于当次命令，防"批准一次永久放行"
 * - hash 精确匹配：规范化命令（去空白/统一引号/小写）→ hash，
 *   防 LLM 重发时改文本导致匹配失败（防张冠李戴/防篡改）
 */
import { getLogger } from '@modules/monitoring';
const logger = getLogger('permission:approvedCommands');

/** 批准记录默认 TTL（毫秒）— P0-1: 60s → 5min，匹配"批准→LLM 续跑"真实耗时（实测 75–131s） */
const DEFAULT_TTL_MS = 300_000;

/** 环境变量：批准放行缓存 TTL（毫秒） */
const APPROVAL_TTL_ENV = 'PERMISSION_APPROVAL_TTL_MS';

/** 定时清理间隔（毫秒） */
const CLEANUP_INTERVAL_MS = 30_000;

/**
 * 命令规范化：统一引号、压缩空白、运算符贴边、小写。
 * 与 BashTool 拦截前的原始命令在同一规范化函数下计算 hash，保证两端一致。
 */
export function normalizeCommand(command: string): string {
  return command
    .replace(/['"]/g, '"') // 统一引号为双引号
    .replace(/\s+/g, ' ') // 压缩连续空白为单空格
    .replace(/\s+([|&;<>()])/g, '$1') // 运算符前去空白
    .replace(/([|&;<>()])\s+/g, '$1') // 运算符后去空白
    .trim()
    .toLowerCase(); // Windows 命令大小写不敏感
}

/**
 * 命令 hash（djb2 风格）：非加密用途，仅用于匹配放行缓存。
 */
export function hashCommand(command: string): string {
  const normalized = normalizeCommand(command);
  let h = 5381;
  for (let i = 0; i < normalized.length; i++) {
    h = ((h << 5) + h + normalized.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
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
 */
export function hashCommandForExecution(command: string): string {
  let c = command;
  if (process.platform === 'win32') {
    c = c.replace(/\/tmp\b/g, '%TEMP%').replace(/\/dev\/null\b/g, 'NUL');
  }
  return hashCommand(c);
}

interface ApprovalEntry {
  hash: string;
  expiresAt: number;
  /** P0-3: 批准命令的命令名（首个 token），供命令名级放行 */
  baseCommand?: string;
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

  constructor(ttlMs: number = DEFAULT_TTL_MS, autoCleanup = true) {
    this.ttlMs = ttlMs;
    if (autoCleanup) {
      this.cleanupTimer = setInterval(
        () => this.cleanup(),
        CLEANUP_INTERVAL_MS
      );
      // 避免定时器阻止进程退出（测试环境）
      this.cleanupTimer.unref?.();
    }
  }

  /** 记录一条已批准命令（幂等）；传入 command 时记录命令名供命令名级放行（P0-3） */
  approve(sessionId: string, hash: string, command?: string): void {
    if (!sessionId || !hash) return;
    let sessionMap = this.store.get(sessionId);
    if (!sessionMap) {
      sessionMap = new Map();
      this.store.set(sessionId, sessionMap);
    }
    sessionMap.set(hash, {
      hash,
      expiresAt: Date.now() + this.ttlMs,
      baseCommand: command ? getBaseCommand(command) : undefined,
    });
    logger.info('危险命令已批准（放行缓存写入）', { sessionId, hash });
  }

  /** 命令是否已批准（session 隔离 + 未过期，精确 hash 匹配） */
  isApproved(sessionId: string, hash: string): boolean {
    if (!sessionId || !hash) return false;
    const sessionMap = this.store.get(sessionId);
    if (!sessionMap) return false;
    const entry = sessionMap.get(hash);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      sessionMap.delete(hash);
      return false;
    }
    return true;
  }

  /**
   * P0-3: 命令名级放行 — 同 session 内批准过该命令名且该命令名非危险命令。
   *
   * 用途：仅用于 ChatManager 跳过 ask 弹卡（避免 LLM 重发文本漂移导致重复弹卡）；
   * BashTool 安全拦截层仍作为兜底执行（危险命令参数漂移会被安全层拦截）。
   * 危险命令必须精确 hash 命中（isApproved），防止 `rm -rf A` 放行 `rm -rf B`。
   */
  isCommandNameApproved(sessionId: string, command: string): boolean {
    if (!sessionId || !command) return false;
    const base = getBaseCommand(command);
    if (!base || DANGEROUS_BASE_NAMES.has(base)) return false;
    const sessionMap = this.store.get(sessionId);
    if (!sessionMap) return false;
    const now = Date.now();
    for (const entry of sessionMap.values()) {
      if (entry.baseCommand === base && now <= entry.expiresAt) return true;
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
  return DEFAULT_TTL_MS;
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
