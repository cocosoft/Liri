// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Windows 沙箱（Low IL + Job Object）能力探测（2026-10-26，方案 §3.4）
//
// 判定分两层：
//   ① `available`：**helper 能不能找到**（`win-sandbox-run.exe`），保持历史语义；
//   ② `runnable`（2026-11-19 新增）：找到后再跑 `--probe` **实测能力**。
// 为什么现在能探测：helper 的 `--probe`（2026-11-19 补）只建一次受限令牌 + Job Object 就退出，
// **不启动任何子进程** ⇒ 无副作用，可安全当探测手段（原先"每次运行都会真起 Low IL 子进程"
// 的顾虑只适用于**执行态**，不适用于 `--probe`）。
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  WIN_SANDBOX_HELPER_BIN_NAME,
  resolveWinSandboxHelperPath,
} from './helperPaths';

export interface WindowsSandboxCapability {
  /** helper 文件**是否存在**（历史语义，保持不变） */
  available: boolean;
  /** 是否存在（与 `available` 同值；显式字段供探针区分 present / runnable） */
  present?: boolean;
  /**
   * `--probe` **实测**结论（2026-11-19）：`true`=能力可用；`false`=不可用；
   * 缺省/`null`=未探测（非 Windows 或总开关关闭）。**不得**用 `available` 代替它。
   */
  runnable?: boolean | null;
  /** 不可用原因（**人类可读**文案，含构建提示；机读码见 `reasonCode`） */
  reason?: string;
  /** 机读原因码：ok / helper-missing / probe-failed / probe-timeout */
  reasonCode?: string;
  /** 可用时的绝对路径（PATH 兜底时为解析结果） */
  path?: string;
}

/** `--probe` 结果（最小形状，便于测试注入） */
export interface WindowsSandboxProbeResult {
  ok: boolean;
  reason?: string;
}

const PROBE_TIMEOUT_MS = 5_000;

/** 默认探测：跑 `helper --probe`（无副作用：只建令牌 + Job 后退出） */
function runProbeDefault(helperPath: string): WindowsSandboxProbeResult {
  try {
    const out = spawnSync(helperPath, ['--probe'], {
      encoding: 'utf8',
      timeout: PROBE_TIMEOUT_MS,
      windowsHide: true,
    });
    if (out.error) {
      const code = (out.error as NodeJS.ErrnoException).code;
      return {
        ok: false,
        reason: code === 'ETIMEDOUT' ? 'probe-timeout' : 'probe-failed',
      };
    }
    if (out.status !== 0) return { ok: false, reason: 'probe-failed' };
    // helper 输出单行 JSON；只认显式 ok:true（不把任意输出当通过）
    return /"ok"\s*:\s*true/.test(`${out.stdout ?? ''}`)
      ? { ok: true }
      : { ok: false, reason: 'probe-failed' };
  } catch {
    // @ignore-catch 探测失败 ⇒ 如实标记不可执行（不臆造"可用"）
    return { ok: false, reason: 'probe-failed' };
  }
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
    /** 测试可注入：默认真跑 `helper --probe` */
    probe?: (helperPath: string) => WindowsSandboxProbeResult;
  } = {}
): WindowsSandboxCapability {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') {
    return {
      available: false,
      present: false,
      runnable: null,
      reasonCode: 'not-windows',
      reason: `非 Windows 平台（${platform}）`,
    };
  }
  if (cached) return cached;

  const resolved = resolveWinSandboxHelperPath({
    platform,
    ...(options.pathExists ? { exists: options.pathExists } : {}),
  });

  /** 找到 helper 后**实测** `--probe`（不再"存在即可用"） */
  const withProbe = (helperPath: string): WindowsSandboxCapability => {
    const probe = (options.probe ?? runProbeDefault)(helperPath);
    return {
      available: true,
      present: true,
      runnable: probe.ok,
      reasonCode: probe.ok ? 'ok' : (probe.reason ?? 'probe-failed'),
      ...(probe.ok
        ? {}
        : {
            reason: `helper --probe 未通过（${probe.reason ?? 'probe-failed'}）`,
          }),
      path: helperPath,
    };
  };

  if (looksAbsolute(resolved)) {
    cached = (options.pathExists ?? existsSync)(resolved)
      ? withProbe(resolved)
      : {
          available: false,
          present: false,
          runnable: false,
          reasonCode: 'helper-missing',
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
    ? withProbe(onPath)
    : {
        available: false,
        present: false,
        runnable: false,
        reasonCode: 'helper-missing',
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
