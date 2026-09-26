/**
 * 沙箱安全策略
 * 定义工具白名单 / 黑名单，控制沙箱内可用的工具范围
 * 对齐 OpenClaw config/sessions/reset-policy.ts
 */

import { getLogger } from '@modules/monitoring';
const logger = getLogger('sandbox:policy');

export interface SandboxToolPolicy {
  allowedTools: Set<string>;
  deniedTools: Set<string>;
  allowAll: boolean;
}

export type SandboxMode = 'host' | 'docker' | 'pty' | 'off';

export interface SandboxGlobalPolicy {
  mode: SandboxMode;
  nonMainSessions: SandboxToolPolicy;
  mainSession: SandboxToolPolicy;
  maxExecutionTimeMs: number;
  /** **软上限**（保上下文）：超出即丢弃，保留前 N 字节供模型/日志阅读 */
  maxOutputBytes: number;
  /** **硬上限**（防 OOM）：进程缓冲/传输层不得超出（B1 双层语义） */
  maxOutputBytesHard: number;
  allowInteractive: boolean;
}

/**
 * 输出上限的**唯一来源**（B1，2026-09-26，《Liri 优化方案》）。
 *
 * **双层语义**（对齐 `tools/bash/BashTool.ts` 的成熟分法）：
 * - `MAX_OUTPUT_BYTES_SOFT`：**软截断**（保上下文）—— 命中也只是丢弃后续输出；
 * - `MAX_OUTPUT_BYTES_HARD`：**硬上限**（防 OOM）—— 任何一层都不得超出。
 *
 * **改前状况（实测）**：策略层 `maxOutputBytes` **零消费者**（仅 `sandbox/index.ts` 桶导出），
 * 而后端 `PTYSandbox` / `SSHSandbox` **各写一份 1MB 默认值** ⇒ 名义契约 ≠ 实际契约。
 * 现在两侧都从**本文件**取数：后端 `resolveOutputLimit({ soft: 配置值 })`，不再自设默认。
 *
 * ⚠️ **不同层不要混**：`DockerSandbox.ts` 的 `exec` `maxBuffer`（10MB）属**子进程缓冲**层，
 * 与"输出上限"不是一回事，**不由此派生**（方案 §1.1 #14 的更正）。同理 `tools/bash/BashTool.ts`
 * 的 16MB/2MB 是**工具层**软硬双限，语义自成一档，其实现是本双层语义的**参照**而非消费者。
 */
export const MAX_OUTPUT_BYTES_SOFT = 1024 * 1024;
export const MAX_OUTPUT_BYTES_HARD = 16 * 1024 * 1024;

/**
 * 把 `block` 追加进 `acc`，但**不越过** `limitChars`；返回新值与**被丢弃的真实字节数**。
 *
 * **为什么需要**（B1，2026-09-26）：两个后端原来的写法是"累计长度未超限就**整块**追加"
 * （`if (acc.length < limit) acc += chunk`）⇒ 单块输出可以直接突破上限、且**无法确定性判定**
 * 是否真的截断（命中与否取决于 OS 分块时机）⇒ 边界单测不可写。本助手逐块**按剩余量切片**。
 *
 * **单位说明（如实）**：`limitChars` 按**字符数**比较 —— 与既有实现一致（`maxOutputBytes`
 * 名义为字节，实际按 `String.length` 比较，属既有口径）；但**丢弃量按真实字节**统计，
 * 使 `truncatedBytes` 可作准。严格字节口径需改造累积结构，留待后续批次。
 */
export function appendWithinLimit(
  acc: string,
  block: string,
  limitChars: number
): { text: string; droppedBytes: number } {
  const remaining = limitChars - acc.length;
  if (remaining <= 0) {
    return { text: acc, droppedBytes: Buffer.byteLength(block, 'utf-8') };
  }
  if (block.length <= remaining) {
    return { text: acc + block, droppedBytes: 0 };
  }
  return {
    text: acc + block.slice(0, remaining),
    droppedBytes: Buffer.byteLength(block.slice(remaining), 'utf-8'),
  };
}

/**
 * 解析实际生效的输出上限 —— **后端统一经此取数**（不各自写默认值）。
 *
 * 边界：软上限不得大于硬上限；非法组合（如误配反了）回落为硬上限并告警，而不是静默采用。
 */
export function resolveOutputLimit(
  overrides: { soft?: number; hard?: number } = {}
): { soft: number; hard: number } {
  const hard = overrides.hard ?? MAX_OUTPUT_BYTES_HARD;
  const soft = overrides.soft ?? MAX_OUTPUT_BYTES_SOFT;
  if (soft > hard) {
    logger.warning('输出上限配置异常：软上限 > 硬上限，已回落为硬上限', {
      soft,
      hard,
    });
    return { soft: hard, hard };
  }
  return { soft, hard };
}

const DEFAULT_ALLOWED_BASE_TOOLS = new Set([
  'bash',
  'read',
  'write',
  'edit',
  'search',
  'grep',
  'glob',
  'list_files',
  'get_file_info',
  'sessions_list',
  'sessions_history',
  'sessions_send',
  'sessions_spawn',
]);

const DEFAULT_DENIED_TOOLS = new Set([
  'browser',
  'canvas',
  'nodes',
  'cron',
  'discord',
  'gateway',
  'slack',
  'telegram',
  'web_fetch_external',
  'network_external',
]);

export function createSandboxPolicy(
  overrides: Partial<SandboxGlobalPolicy> = {}
): SandboxGlobalPolicy {
  return {
    mode: overrides.mode || 'pty',
    nonMainSessions: {
      allowedTools: new Set(DEFAULT_ALLOWED_BASE_TOOLS),
      deniedTools: new Set(DEFAULT_DENIED_TOOLS),
      allowAll: false,
      ...overrides.nonMainSessions,
    },
    mainSession: {
      allowedTools: new Set(DEFAULT_ALLOWED_BASE_TOOLS),
      deniedTools: new Set(DEFAULT_DENIED_TOOLS),
      allowAll: true,
      ...overrides.mainSession,
    },
    maxExecutionTimeMs: overrides.maxExecutionTimeMs || 300000,
    // B1：唯一来源取数（改前是就地硬编码 `1024 * 1024`，与后端各自的 1MB 默认互不相干）
    maxOutputBytes: overrides.maxOutputBytes ?? MAX_OUTPUT_BYTES_SOFT,
    maxOutputBytesHard: overrides.maxOutputBytesHard ?? MAX_OUTPUT_BYTES_HARD,
    allowInteractive: overrides.allowInteractive ?? false,
  };
}

export function isToolAllowed(
  policy: SandboxToolPolicy,
  toolName: string
): boolean {
  if (policy.allowAll) return !policy.deniedTools.has(toolName);
  return policy.allowedTools.has(toolName) && !policy.deniedTools.has(toolName);
}

export function getAllowedTools(
  policy: SandboxToolPolicy,
  availableTools: string[]
): string[] {
  return availableTools.filter((t) => isToolAllowed(policy, t));
}

export function getDeniedTools(
  policy: SandboxToolPolicy,
  availableTools: string[]
): string[] {
  return availableTools.filter((t) => !isToolAllowed(policy, t));
}

export function restrictToolSet(
  globalPolicy: SandboxGlobalPolicy,
  isMainSession: boolean
): SandboxToolPolicy {
  if (isMainSession) {
    return globalPolicy.mainSession;
  }
  return globalPolicy.nonMainSessions;
}

export function validateToolAccess(
  policy: SandboxToolPolicy,
  toolName: string
): { allowed: boolean; reason?: string } {
  if (!isToolAllowed(policy, toolName)) {
    if (policy.deniedTools.has(toolName)) {
      return { allowed: false, reason: `工具 "${toolName}" 在沙箱黑名单中` };
    }
    return { allowed: false, reason: `工具 "${toolName}" 不在沙箱白名单中` };
  }
  return { allowed: true };
}

/**
 * 默认生产环境沙箱策略（参考 OpenClaw 的安全默认值）
 */
export const PRODUCTION_SANDBOX_POLICY = createSandboxPolicy({
  mode: 'docker',
  nonMainSessions: {
    allowedTools: new Set(DEFAULT_ALLOWED_BASE_TOOLS),
    deniedTools: new Set([
      ...DEFAULT_DENIED_TOOLS,
      'browser',
      'canvas',
      'nodes',
      'cron',
      'discord',
      'gateway',
    ]),
    allowAll: false,
  },
  mainSession: {
    allowedTools: new Set(DEFAULT_ALLOWED_BASE_TOOLS),
    deniedTools: new Set(DEFAULT_DENIED_TOOLS),
    allowAll: true,
  },
  maxExecutionTimeMs: 600000,
  // B1：生产策略的**软**上限是**显式策略选择**（8MB），硬上限仍取唯一来源（16MB）
  maxOutputBytes: 8 * 1024 * 1024,
  maxOutputBytesHard: MAX_OUTPUT_BYTES_HARD,
  allowInteractive: false,
});
