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
import { findMountForPath, toIsolatedPath } from './isolationPathMap';
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
 * 当前身份的**全部**挂载映射（宿主根 ↔ 环境内根；§12.15 起支持多挂载）。
 *
 * @returns 空数组 = 无工作区 / 非隔离适配器 / 隔离但缺少挂载映射 ⇒ 文件 IO **不可证隔离**
 */
export function resolveWorkspacePathMaps(): WorkspacePathMap[] {
  try {
    const ws = getScopedDefaultWorkspace();
    if (!ws) return [];
    if (ws.isolationMode() === 'local') return [];
    return ws.fileIoMounts();
  } catch {
    return [];
  }
}

/**
 * **工作区根**对应的挂载（单挂载语义；`resolveWorkspacePathMaps()` 的特例）。
 *
 * @returns `null` = 无工作区 / 非隔离适配器 / 隔离但工作区根未被挂载
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

/** 文件 IO 是否**可证**落在隔离环境（隔离适配器 + 至少一条宿主↔环境挂载） */
export function hasIsolatedFileIo(): boolean {
  return resolveWorkspacePathMaps().length > 0;
}

/**
 * **文件类工具**（`sandboxLevel === 'file-io'`）本次的执行环境模式（2026-10-23）。
 *
 * 与 `resolveWorkspaceIsolationMode()` 的差别：这里要求**挂载映射可用**
 * （无映射 ⇒ 文件不会真的落在环境内 ⇒ 不表态）。用途：执行入口把它作为
 * `modeHint` 传给 `resolveSandboxExecutionSignal()` —— 文件工具的"沙箱内放行"
 * 才不必依赖 Landlock（Landlock 只包命令子进程）。
 *
 * @returns `container` / `ssh`；`local` / 无工作区 / 无挂载 ⇒ `undefined`（不表态）
 */
export function resolveFileIoExecutionMode(): 'container' | 'ssh' | undefined {
  try {
    const ws = getScopedDefaultWorkspace();
    if (!ws) return undefined;
    const mode = ws.isolationMode();
    if (mode === 'local') return undefined;
    return ws.fileIoMounts().length > 0 ? mode : undefined;
  } catch {
    return undefined;
  }
}

/** 工作区文件 IO 端口（`readFile`/`writeFile` 的路径语义 = **环境内绝对路径**） */
export interface WorkspaceFileIo {
  mode: 'container' | 'ssh';
  /** 全部可用挂载（宿主根 ↔ 环境内根）；路径命中多条时取**最长前缀** */
  mounts: WorkspacePathMap[];
  /** 宿主绝对路径 → 环境内绝对路径；无挂载覆盖 ⇒ `null`（调用方保持宿主直写） */
  toIsolatedPath(hostAbsPath: string): string | null;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  /**
   * 在环境内**递归创建目录**（2026-10-23，§12.15：`write_project_file` 落盘前需要）。
   * 失败 ⇒ 抛错（调用方按工具失败处理，不静默）。
   */
  mkdir(path: string): Promise<void>;
  /**
   * 环境内文件的**字节数**（写后回读校验用）。
   * 文件不存在/命令失败 ⇒ 抛错（不得返回 0 冒充成功）。
   */
  statSize(path: string): Promise<number>;
}

/**
 * 取隔离工作区的文件 IO 端口。
 *
 * - 无工作区 / `local` / 隔离但**无挂载映射** ⇒ `null`
 *   （调用方保持既有宿主直写路径，**零行为变更**）；
 * - `container` / `ssh` **且有映射** ⇒ 返回端口（读写都在隔离环境内）。
 *
 * 多挂载（§12.15）：`toIsolatedPath` 按**最长前缀**选挂载；无覆盖 ⇒ `null`。
 */
export function resolveWorkspaceFileIo(): WorkspaceFileIo | null {
  try {
    const ws = getScopedDefaultWorkspace();
    if (!ws) return null;
    const mode = ws.isolationMode();
    if (mode === 'local') return null;
    const mounts = ws.fileIoMounts();
    if (mounts.length === 0) return null;
    // 单引号包裹并对内部单引号转义（`'` → `'\''`），避免路径含空白/引号时命令被拆开
    const shellQuote = (p: string): string => `'${p.replace(/'/g, `'\\''`)}'`;
    const runOrThrow = async (
      command: string,
      what: string,
      path: string
    ): Promise<string> => {
      const result = await ws.execute(command);
      if (!result.success) {
        throw new Error(
          `隔离环境${what}失败: ${path}${result.stderr ? `\n${result.stderr}` : ''}`
        );
      }
      return result.stdout;
    };
    return {
      mode,
      mounts,
      toIsolatedPath: (hostAbsPath) => {
        const mount = findMountForPath(mounts, hostAbsPath);
        return mount ? toIsolatedPath(mount, hostAbsPath) : null;
      },
      readFile: (p) => ws.readFile(p),
      writeFile: (p, c) => ws.writeFile(p, c),
      mkdir: async (p) => {
        await runOrThrow(`mkdir -p ${shellQuote(p)}`, '创建目录', p);
      },
      statSize: async (p) => {
        const stdout = await runOrThrow(
          `stat -c %s ${shellQuote(p)}`,
          '读取文件大小',
          p
        );
        const size = Number(stdout.trim());
        if (!Number.isFinite(size)) {
          throw new Error(`隔离环境返回的文件大小非法: ${stdout.trim()}`);
        }
        return size;
      },
    };
  } catch {
    return null;
  }
}
