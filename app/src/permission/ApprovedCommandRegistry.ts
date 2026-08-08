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
import { Logger } from '@modules/monitoring';

const logger = new Logger({ module: 'permission:approvedCommands' });

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

  /** 记录一条已批准命令（幂等） */
  approve(sessionId: string, hash: string): void {
    if (!sessionId || !hash) return;
    let sessionMap = this.store.get(sessionId);
    if (!sessionMap) {
      sessionMap = new Map();
      this.store.set(sessionId, sessionMap);
    }
    sessionMap.set(hash, { hash, expiresAt: Date.now() + this.ttlMs });
    logger.info('危险命令已批准（放行缓存写入）', { sessionId, hash });
  }

  /** 命令是否已批准（session 隔离 + 未过期） */
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
