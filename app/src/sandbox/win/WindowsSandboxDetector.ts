// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Windows 沙箱（Low IL + Job Object）能力探测（2026-10-26，方案 §3.4）
//
// 判定只看一条硬事实：**helper 能不能找到**（`win-sandbox-run.exe`）。
// 不做"试跑一次"的 probe —— 与 landlock 的 `--probe` 不同，本 helper 每次运行都会
// 真起一个 Low IL 子进程（有副作用），不适合当探测手段；能力本身（MIC/Job）是 Windows
// 原生特性，不存在"内核不支持"的分支（Vista+ 均有）。
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  WIN_SANDBOX_HELPER_BIN_NAME,
  resolveWinSandboxHelperPath,
} from './helperPaths';

export interface WindowsSandboxCapability {
  available: boolean;
  /** 不可用原因（给上层拼 fail-closed 文案） */
  reason?: string;
  /** 可用时的绝对路径（PATH 兜底时为解析结果） */
  path?: string;
}

let cached: WindowsSandboxCapability | null = null;

/** 路径里是否带分隔符（否则视为"裸名 ⇒ 需要走 PATH"） */
function looksAbsolute(path: string): boolean {
  return path.includes('\\') || path.includes('/');
}

/** 在 PATH 上解析裸名（`where.exe`；失败 ⇒ null）。结果由调用方缓存。 */
function resolveOnPath(name: string): string | null {
  try {
    const out = spawnSync('where.exe', [name], { encoding: 'utf8' });
    if (out.status !== 0 || !out.stdout) return null;
    const first = out.stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean);
    return first ?? null;
  } catch {
    // @ignore-catch 解析 PATH 失败 ⇒ 视为未找到（fail-closed，不臆造路径）
    return null;
  }
}

/**
 * 探测 Windows 沙箱可用性（同步 + 缓存）。
 *
 * @param options.platform 测试可注入；默认 `process.platform`
 * @param options.pathExists 测试可注入；默认 `fs.existsSync`
 * @param options.resolveOnPath 测试可注入；默认 `where.exe`
 */
export function detectWindowsSandboxCapability(
  options: {
    platform?: NodeJS.Platform;
    pathExists?: (path: string) => boolean;
    resolveOnPath?: (name: string) => string | null;
  } = {}
): WindowsSandboxCapability {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') {
    return { available: false, reason: `非 Windows 平台（${platform}）` };
  }
  if (cached) return cached;

  const resolved = resolveWinSandboxHelperPath({
    platform,
    ...(options.pathExists ? { exists: options.pathExists } : {}),
  });

  if (looksAbsolute(resolved)) {
    cached = (options.pathExists ?? existsSync)(resolved)
      ? { available: true, path: resolved }
      : {
          available: false,
          reason:
            `未找到 ${resolved}（可用 bun run build:win-sandbox 构建，` +
            `或设置 WIN_SANDBOX_HELPER 指向已有 helper）`,
        };
    return cached;
  }

  const onPath = (options.resolveOnPath ?? resolveOnPath)(
    WIN_SANDBOX_HELPER_BIN_NAME
  );
  cached = onPath
    ? { available: true, path: onPath }
    : {
        available: false,
        reason:
          `未找到 ${WIN_SANDBOX_HELPER_BIN_NAME}（可用 bun run build:win-sandbox 构建，` +
          `或设置 WIN_SANDBOX_HELPER 指向已有 helper）`,
      };
  return cached;
}

/** 测试用：清空缓存 */
export function clearWindowsSandboxCapabilityCache(): void {
  cached = null;
}
