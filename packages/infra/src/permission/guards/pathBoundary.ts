/**
 * 写类工具的**路径硬闸**（D4，2026-11-27）
 *
 * 立论（`dev_docs/20261126/工具与命令治理现状盘点-20261126.md` §7.3 / 修复方案 D4）：
 * 内容级权限规则是**用户自写正则**，不能当边界保证；写类工具此前只有权限层"规则/档位"，
 * 没有针对"写到哪"的硬判据 —— 一条误配的 allow（或 bypass 档）就能写进系统敏感位置。
 *
 * 本模块只做两件事，且**判据全部复用既有实现**（CS01：不新建第二份敏感表）：
 * - `evaluateProtectedWritePath`：目标路径命中 `security/files/ProtectedPaths` 的受保护
 *   文件/目录（shell rc、`/etc` 敏感文件、`~/.ssh`、`~/.aws`、`~/.kube`、Windows SAM/hosts …）
 *   ⇒ **deny**。这是安全地板，五档一致（含 bypass：地板不随档位放宽）。
 * - `evaluateOutOfWorkspaceWrite`：目标路径在**已知工作区根之外** ⇒ **ask**（需显式批准）。
 *   只对"能问"的档位（`default` / `auto`）生效；`plan` 本就每步询问，`dontAsk` / `bypass`
 *   的语义是"不询问/不检查"，故不在此处改判（如实记录，不假装覆盖）。
 *
 * 明确的边界（不夸大）：
 * - 只覆盖**写类工具**（`file_write` / `file_edit` / `file_convert` / `write_project_file`）；
 *   读类工具不纳入本期（读系统文件是常见调试动作，误伤面大）。
 * - 只认入参里的**路径字符串**（见 `PATH_ARG_KEYS`），不做符号链接解引用；
 *   `bash` / `powershell` 的路径判据仍由其工具层硬拦截（`bashSecurityGate`，刻意分层）。
 */
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

import { isPathWithin } from '@openliri/infra/environment/paths';
import {
  getWriteProtectionReason,
  isWriteProtected,
} from '@openliri/infra/security/files/ProtectedPaths';

/** 受本闸约束的写类工具（其余工具零行为变更） */
export const WRITE_PATH_GATED_TOOLS: ReadonlySet<string> = new Set([
  'file_write',
  'file_edit',
  'file_convert',
  'write_project_file',
]);

/**
 * 入参里可能承载目标路径的键。
 *
 * 同时容纳 `file_path`（工具定义用）与 `path`（`agentTool` 侧用）两套命名 ——
 * 只取值、不猜语义，命中任一即判定。
 */
const PATH_ARG_KEYS = [
  'file_path',
  'path',
  'target_path',
  'output_path',
  'source_path',
  'new_path',
  'destination',
] as const;

/** 命中受保护路径的结果（`null` ⇒ 未命中，可继续判定） */
export interface ProtectedWriteHit {
  path: string;
  reason: string;
}

/** 越界写结果（`null` ⇒ 在界内或无法判定） */
export interface OutOfWorkspaceHit {
  path: string;
  workspaceRoots: string[];
}

/** 取入参里的路径候选（去空、去重；非字符串忽略） */
function collectPathArgs(input: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const key of PATH_ARG_KEYS) {
    const value = input[key];
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed.length === 0) continue;
    if (!out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

/** 相对路径按"第一个工作区根"解析；无根时按进程 cwd（与工具自身行为对齐） */
function toAbsolute(candidate: string, roots: readonly string[]): string {
  if (isAbsolute(candidate)) return resolve(candidate);
  const base = roots[0] ?? process.cwd();
  return resolve(base, candidate);
}

/**
 * 写类工具是否写向**受保护路径**（系统 / 凭据 / 持久化劫持面）。
 *
 * @returns 命中 ⇒ 详情；未命中 / 非写类工具 ⇒ `null`
 */
export function evaluateProtectedWritePath(
  toolName: string,
  input: Record<string, unknown>
): ProtectedWriteHit | null {
  if (!WRITE_PATH_GATED_TOOLS.has(toolName)) return null;
  const candidates = collectPathArgs(input);
  if (candidates.length === 0) return null;

  for (const candidate of candidates) {
    // 受保护清单里既有家目录绝对路径也有 `/etc/...`；先展开 `~` 再解析
    const expanded = candidate.startsWith('~')
      ? candidate.replace(/^~(?=$|[\\/])/, homedir())
      : candidate;
    const absolute = toAbsolute(expanded, []);
    if (!isWriteProtected(absolute)) continue;
    return {
      path: absolute,
      reason:
        getWriteProtectionReason(absolute) ||
        `路径 '${absolute}' 属于受保护的系统 / 凭据位置`,
    };
  }
  return null;
}

/**
 * 写类工具是否写到**工作区之外**（仅当调用方给出工作区根时可判定）。
 *
 * @returns 越界 ⇒ 详情；界内 / 无根可用 / 非写类工具 ⇒ `null`
 */
export function evaluateOutOfWorkspaceWrite(
  toolName: string,
  input: Record<string, unknown>,
  workspaceRoots: readonly string[] | undefined
): OutOfWorkspaceHit | null {
  if (!WRITE_PATH_GATED_TOOLS.has(toolName)) return null;
  const roots = (workspaceRoots ?? []).filter((root) => root.trim().length > 0);
  if (roots.length === 0) return null;

  const candidates = collectPathArgs(input);
  for (const candidate of candidates) {
    const absolute = toAbsolute(candidate, roots);
    // 受保护路径由 `evaluateProtectedWritePath` 负责（deny 优先），这里只判边界
    if (isWriteProtected(absolute)) continue;
    if (!roots.some((root) => isPathWithin(root, absolute))) {
      return { path: absolute, workspaceRoots: [...roots] };
    }
  }
  return null;
}
