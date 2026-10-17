// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * U-03b / U-09（2026-10-17）：长程任务工具调用的 workspace 收敛。
 *
 * 背景：LRO 的工具上下文 `options.cwd` 已指向隔离工作区，但模型可显式传绝对路径
 * 或 `../` 跳出工作区（读系统目录 / 写项目根）。本模块在工具执行前做一次纯函数校验，
 * 仅对**路径语义入参**生效（单一事实源 = `PATH_ARG_KEYS`）。
 */
import { isAbsolute, relative, resolve } from 'path';
import { PATH_ARG_KEYS } from '@modules/query';

export interface WorkspaceEscape {
  key: string;
  value: string;
  resolved: string;
}

/**
 * 查找第一个越界路径参数；全部在 workspace 内（或该工具无路径参数）⇒ `null`。
 *
 * 规则：相对路径按 workspace 解析；绝对路径必须仍位于 workspace 内。
 */
export function findWorkspaceEscape(
  workspace: string,
  args: Record<string, unknown>
): WorkspaceEscape | null {
  const root = resolve(workspace);
  for (const key of PATH_ARG_KEYS) {
    const value = args[key];
    if (typeof value !== 'string' || !value.trim()) continue;

    const resolved = isAbsolute(value) ? resolve(value) : resolve(root, value);
    const rel = relative(root, resolved);
    if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) continue;

    return { key, value, resolved };
  }
  return null;
}
