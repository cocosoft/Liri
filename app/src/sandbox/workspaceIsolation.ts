// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * workspaceIsolation — 「本次文件 IO 是否真的落在隔离环境内」（方案 A，2026-10-23）
 *
 * 背景（§12.11 核对结论）：`ToolUseContext.sandbox.mode` 只说明**环境具备**隔离能力
 * （Landlock 只包住 `bash`/`code_run`/`powershell` 的**子进程**），并**不**说明
 * `file_write` 这类工具被隔离。若直接据此豁免文件写 → 安全漏洞。
 *
 * 证据链（两条都得成立，缺一即"未隔离"）：
 * 1. **适配器是隔离环境**：`WorkspaceBase.isolationMode()` 为 `container` / `ssh`
 *    （`LocalWorkspace` 直写宿主 fs ⇒ 不是隔离）；
 * 2. **有可用的挂载映射**：`WorkspaceBase.fileIoMount()` 给出"宿主工作区根 ↔ 环境内根"，
 *    才能把工具解析出的**宿主绝对路径**翻译成环境内路径（`isolationPathMap.toIsolatedPath`）。
 *
 * 只有两条同时成立，文件类工具才会**经适配器读写**（`resolveWorkspaceFileIo()`），
 * 并允许 `sandboxExemption` 视 `fileIoIsolated` 为真。
 */

import type { WorkspacePathMap } from './isolationPathMap';
import { toIsolatedPath } from './isolationPathMap';
import { getScopedDefaultWorkspace } from './scopedDefaultWorkspace';

/** 工作区隔离形态（`local` = 宿主进程直写，**不算隔离**） */
export type WorkspaceIsolationMode = 'local' | 'container' | 'ssh';

/**
 * 当前请求身份的默认工作区隔离形态。
 *
 * @returns `null` = 无默认工作区（本地身份且未建）；否则取适配器自报。
 */
export function resolveWorkspaceIsolationMode(): WorkspaceIsolationMode | null {
  try {
    const ws = getScopedDefaultWorkspace();
    if (!ws) return null;
    return ws.isolationMode();
  } catch {
    // 工作区解析异常 ⇒ 视为无隔离证据（fail-closed）
    return null;
  }
}

/**
 * 当前身份的**挂载映射**（宿主根 ↔ 环境内根）。
 *
 * @returns `null` = 无工作区 / 非隔离适配器 / 隔离但缺少挂载映射 ⇒ 文件 IO **不可证隔离**
 */
export function resolveWorkspacePathMap(): WorkspacePathMap | null {
  try {
    const ws = getScopedDefaultWorkspace();
    if (!ws) return null;
    if (ws.isolationMode() === 'local') return null;
    return ws.fileIoMount();
  } catch {
    return null;
  }
}

/** 文件 IO 是否**可证**落在隔离环境（隔离适配器 + 可用的宿主↔环境路径映射） */
export function hasIsolatedFileIo(): boolean {
  return resolveWorkspacePathMap() !== null;
}

/** 工作区文件 IO 端口（`readFile`/`writeFile` 的路径语义 = **环境内绝对路径**） */
export interface WorkspaceFileIo {
  mode: 'container' | 'ssh';
  /** 宿主侧工作区根（映射源） */
  hostRoot: string;
  /** 环境内对应根 */
  isolatedRoot: string;
  /** 宿主绝对路径 → 环境内绝对路径；不在工作区内 ⇒ `null`（调用方保持宿主直写） */
  toIsolatedPath(hostAbsPath: string): string | null;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
}

/**
 * 取隔离工作区的文件 IO 端口。
 *
 * - 无工作区 / `local` / 隔离但**无挂载映射** ⇒ `null`
 *   （调用方保持既有宿主直写路径，**零行为变更**）；
 * - `container` / `ssh` **且**有映射 ⇒ 返回端口（读写都在隔离环境内）。
 */
export function resolveWorkspaceFileIo(): WorkspaceFileIo | null {
  try {
    const ws = getScopedDefaultWorkspace();
    if (!ws) return null;
    const mode = ws.isolationMode();
    if (mode === 'local') return null;
    const map = ws.fileIoMount();
    if (!map) return null;
    return {
      mode,
      hostRoot: map.hostRoot,
      isolatedRoot: map.isolatedRoot,
      toIsolatedPath: (hostAbsPath) => toIsolatedPath(map, hostAbsPath),
      readFile: (p) => ws.readFile(p),
      writeFile: (p, c) => ws.writeFile(p, c),
    };
  } catch {
    return null;
  }
}
