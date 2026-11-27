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
 * SG-1（2026-11-27）：**REPL / notebook 执行面的平台写隔离**。
 *
 * 背景（`.trae/specs/tool-security-governance-plan.md` §13.2 SG-1）：`notebook.executeCell` /
 * `executeAllCells` 与 `repl.execute` 经 `REPLToolImpl.spawnREPL` 直接
 * `spawn(command, args, { cwd, env, stdio: 'pipe' })` —— 审批面没问题（风险已按 `shell` 档），
 * 但**批准之后仍不受写隔离**，而两款工具都声明 `sandboxLevel = 'execution'`（与 bash / code_run 同档）。
 *
 * 本模块把 REPL 的 spawn 接到**同一套**平台沙箱上（三平台分别验证）：
 *  - Linux：`landlock-run <规则> -- <解释器> <参数…>`（内核 Landlock 域）；
 *  - macOS：`/usr/bin/sandbox-exec -p <SBPL> -- <解释器> <参数…>`（Seatbelt）；
 *  - Windows：`win-sandbox-run.exe -- <解释器> <参数…>`（Low IL + Job Object），
 *    并在会话生命周期内把可写目录**临时**降为 Low 完整性标签，`stopREPL` / 进程退出时恢复。
 *
 * **为什么能在包裹后保持"交互式 REPL"**：
 *  - `landlock-run`（`native/main.c`）在 `restrict_self` 成功后直接 `execvp(command)`；
 *  - `sandbox-exec` 也是"设好 profile 再 exec 目标程序"；
 *  - `win-sandbox-run.exe` 以 `bInheritHandles=TRUE` 建进程，子进程**继承** Node 侧的三条 pipe
 *    句柄（`--timeout-ms 0` = 不限时，由 REPL 自己的 `executeCode` 超时兜底）；`code_run` 的
 *    Windows 执行器已用同一条路径做常驻 RPC，故"长驻 + 管道"是既有能力。
 *  ⇒ 三者的 stdio 都是**透传**，REPL 的 marker 协议与跨执行状态（同一进程）都不受影响。
 *
 * **写白名单与 bash 同源（CS01）**：目录清单取 `buildShellManagedWritableDirs`，Linux 策略取
 * `buildBashLandlockPolicy` —— 不复制第二份清单。
 *
 * **不可用时的语义（与 `code_run` 同口径，如实）**：
 *  - `sandbox.landlock.enabled=false` ⇒ 不隔离（用户关掉了沙箱子系统），日志说明；
 *  - 能力不可用 / helper 缺失 / Windows 授权失败 ⇒ `failClosed=false`（默认）**降级普通 spawn**
 *    并 WARN 说明原因；`failClosed=true` ⇒ **拒绝启动**（`refuse`），不静默降级。
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import {
  buildLandlockArgv,
  buildMacOSSandboxProfile,
  buildWinSandboxArgv,
  detectMacOSSandboxCapability,
  detectWindowsSandboxCapability,
  LandlockDetector,
  MACOS_SANDBOX_EXEC_PATH,
  readLandlockConfig,
  resolveLandlockHelperPath,
  resolveWinSandboxHelperPath,
} from '@modules/sandbox';
import type {
  LandlockCapability,
  LandlockConfig,
  MacOSSandboxCapability,
  WindowsSandboxCapability,
} from '@modules/sandbox';
import { resolveTempDir } from '@openliri/infra/environment';
import { AppError, ErrorCategory, ErrorSeverity } from '@openliri/infra/error';
import { getLogger } from '@openliri/infra/monitoring';
import {
  buildBashLandlockPolicy,
  buildShellManagedWritableDirs,
} from '@modules/tools/bash/bashLandlockExec';
import { beginWindowsBashGrants } from '@modules/tools/bash/bashWindowsSandbox';

const logger = getLogger('tools:repl:sandbox');

/** 实际生效的写隔离后端（`none` = 未隔离；`refuse` = 按 fail-closed 拒绝启动） */
export type ReplSandboxPlanMode =
  | 'landlock'
  | 'sandbox-exec'
  | 'windows-low-il'
  | 'none'
  | 'refuse';

/** spawn 计划：`command`/`args`/`env` 已按沙箱形态改写，调用方直接交给 `spawn` */
export interface ReplSandboxPlan {
  /** 实际 spawn 的程序（沙箱模式 ⇒ helper / `sandbox-exec`） */
  command: string;
  args: string[];
  /** 实际使用的环境（Windows 会把 TEMP/TMP 指到受管临时目录） */
  env: NodeJS.ProcessEnv;
  mode: ReplSandboxPlanMode;
  /** 机读原因（日志/测试断言用） */
  reason: string;
  /** `mode='none'` 时的人类可读告警（说明"这次为什么没隔离"） */
  warning?: string;
  /** `mode='refuse'` 时的可操作错误文案 */
  message?: string;
  /**
   * Windows 会话级授权释放（`stopREPL` / 子进程退出时调用，必须幂等）。
   * 其余平台为 `undefined`。
   */
  release?: () => Promise<void>;
}

/** Windows 授权会话的最小形状（`beginWindowsBashGrants` 的返回子集；测试可注入） */
export interface WindowsGrantSessionLike {
  ok: boolean;
  failures: { dir: string; error: string }[];
  release: () => Promise<void>;
}

export interface ReplSandboxPlannerDeps {
  /** 配置覆盖（默认 `readLandlockConfig()`） */
  config?: LandlockConfig;
  /** 平台覆盖（默认 `process.platform`） */
  platform?: NodeJS.Platform;
  /** Landlock 能力探测（默认 `LandlockDetector.detect`） */
  detectLandlock?: () => Promise<LandlockCapability>;
  /** macOS Seatbelt 能力探测（默认 `detectMacOSSandboxCapability`） */
  detectMac?: () => MacOSSandboxCapability;
  /** Windows Low IL 能力探测（默认 `detectWindowsSandboxCapability`） */
  detectWin?: () => WindowsSandboxCapability;
  /** landlock helper 路径（默认 `resolveLandlockHelperPath()`） */
  landlockHelperPath?: string;
  /** Windows helper 路径（默认 `resolveWinSandboxHelperPath()`） */
  winHelperPath?: string;
  /** 规则路径存在性（默认 `fs.existsSync`，见 `buildLandlockArgv`） */
  pathExists?: (path: string) => boolean;
  /** Windows 程序解析（默认 `where.exe`；返回 `null` = 不是可直接 CreateProcess 的 `.exe`） */
  resolveWinExecutable?: (command: string) => string | null;
  /** Windows 授权（默认 `beginWindowsBashGrants`；测试注入以免改真实 ACL） */
  beginWinGrants?: (dirs: string[]) => Promise<WindowsGrantSessionLike>;
}

export interface ReplSandboxSpawnInput {
  /** 解释器命令（`python` / `node` / `npx` …） */
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  deps?: ReplSandboxPlannerDeps;
}

/** 「不可用」结果（含 fail-closed 拒绝） */
function unavailable(
  input: ReplSandboxSpawnInput,
  reason: string,
  detail: string,
  failClosed: boolean
): ReplSandboxPlan {
  if (failClosed) {
    return {
      command: input.command,
      args: input.args,
      env: input.env,
      mode: 'refuse',
      reason,
      message:
        `REPL / notebook 的执行面需要写隔离，但本机无法施加（原因：${detail}）。` +
        `按 sandbox.landlock.failClosed=true 拒绝启动，而不是静默降级为无约束执行。` +
        `请修好该平台的沙箱能力（见原因），或把 sandbox.landlock.failClosed 置为 false。`,
    };
  }
  return {
    command: input.command,
    args: input.args,
    env: input.env,
    mode: 'none',
    reason,
    warning:
      `REPL / notebook 执行面未进写隔离（原因：${detail}）⇒ 降级为普通 spawn；` +
      `本次执行的写入不受沙箱约束。`,
  };
}

/** 解析 Windows 上可直接交给 `CreateProcess` 的 `.exe`（`npx` 之类 `.cmd` 一律不通过） */
function defaultResolveWinExecutable(command: string): string | null {
  if (/\.exe$/i.test(command)) return command;
  // 带路径但不是 .exe（如 `C:\...\npx.cmd`）⇒ 无法直接 CreateProcess
  if (command.includes('\\') || command.includes('/')) return null;
  try {
    const out = spawnSync('where.exe', [command], {
      encoding: 'utf8',
      timeout: 5_000,
      windowsHide: true,
    });
    if (out.status !== 0 || !out.stdout) return null;
    const first = out.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    return first && /\.exe$/i.test(first) ? first : null;
  } catch {
    // @ignore-catch 解析失败 ⇒ 视为不可沙箱化（走降级/拒绝分支，不臆造路径）
    return null;
  }
}

/**
 * 计算本次 REPL spawn 的形态（**纯决策 + 必要的平台探测**）。
 *
 * 调用方（`REPLToolImpl.startREPL`）只需按返回的 `command`/`args`/`env` 去 `spawn`，
 * 并在会话结束时调用 `release`。`mode='refuse'` ⇒ 抛错，不 spawn。
 */
export async function planReplSandboxSpawn(
  input: ReplSandboxSpawnInput
): Promise<ReplSandboxPlan> {
  const deps = input.deps ?? {};
  const config = deps.config ?? readLandlockConfig();
  const platform = deps.platform ?? process.platform;
  const extraWritablePaths = config.bashExtraWritablePaths;

  if (!config.enabled) {
    return {
      command: input.command,
      args: input.args,
      env: input.env,
      mode: 'none',
      reason: 'master-off',
      warning:
        '沙箱子系统已关闭（sandbox.landlock.enabled=false）⇒ REPL / notebook 执行面不隔离。',
    };
  }

  if (platform === 'linux') {
    const capability = await (
      deps.detectLandlock ??
      (() =>
        LandlockDetector.detect({
          helperPath: deps.landlockHelperPath ?? resolveLandlockHelperPath(),
        }))
    )();
    if (!capability.available) {
      return unavailable(
        input,
        'landlock-unavailable',
        `本机 Landlock 不可用（${capability.reason ?? '未知'}）`,
        config.failClosed
      );
    }
    const helperPath = deps.landlockHelperPath ?? resolveLandlockHelperPath();
    const policy = buildBashLandlockPolicy({
      cwd: input.cwd,
      abi: capability.abi,
      extraWritablePaths,
    });
    return {
      command: helperPath,
      args: [
        ...buildLandlockArgv(policy, deps.pathExists),
        '--',
        input.command,
        ...input.args,
      ],
      env: input.env,
      mode: 'landlock',
      reason: 'landlock-available',
    };
  }

  if (platform === 'darwin') {
    const macCapability = (deps.detectMac ?? detectMacOSSandboxCapability)();
    if (!macCapability.available) {
      return unavailable(
        input,
        'sandbox-exec-unavailable',
        `macOS Seatbelt 不可用（${macCapability.reason ?? '未知'}）`,
        config.failClosed
      );
    }
    return {
      command: macCapability.path ?? MACOS_SANDBOX_EXEC_PATH,
      args: [
        '-p',
        buildMacOSSandboxProfile({
          writablePaths: buildShellManagedWritableDirs({
            cwd: input.cwd,
            extraWritablePaths,
            includeDev: true,
          }),
        }),
        '--',
        input.command,
        ...input.args,
      ],
      env: input.env,
      mode: 'sandbox-exec',
      reason: 'seatbelt-available',
    };
  }

  if (platform === 'win32') {
    const winCapability = (deps.detectWin ?? detectWindowsSandboxCapability)();
    // `runnable === false` = `--probe` 实测失败 ⇒ 与"找不到 helper"同等对待
    if (!winCapability.available || winCapability.runnable === false) {
      return unavailable(
        input,
        'windows-helper-unavailable',
        `Windows 沙箱 helper 不可用（${winCapability.reason ?? '未知'}）`,
        config.failClosed
      );
    }
    const exe = (deps.resolveWinExecutable ?? defaultResolveWinExecutable)(
      input.command
    );
    if (!exe) {
      // `.cmd` / `.bat`（如 npx）无法被 helper 直接 CreateProcess ⇒ 如实降级
      return unavailable(
        input,
        'windows-non-exe',
        `命令 ${input.command} 不是可直接启动的 .exe（.cmd/.bat 需经 shell，helper 不支持）`,
        config.failClosed
      );
    }

    // 子进程的 TEMP/TMP 指到受管临时目录（否则 Low IL 写 %TEMP% 会被 MIC 拒绝）
    const windowsTemp = resolveTempDir();
    try {
      mkdirSync(windowsTemp, { recursive: true });
    } catch {
      // @ignore-catch 建不出临时目录不致命：命令仍可执行，只是写 TEMP 时会被拒
    }
    const childEnv: NodeJS.ProcessEnv = {
      ...input.env,
      TEMP: windowsTemp,
      TMP: windowsTemp,
      TMPDIR: windowsTemp,
    };

    const writableDirs = buildShellManagedWritableDirs({
      cwd: input.cwd,
      extraWritablePaths,
    });
    const grants = await (deps.beginWinGrants ?? beginWindowsBashGrants)(
      writableDirs
    );
    if (!grants.ok) {
      await grants.release();
      return unavailable(
        input,
        'windows-grant-failed',
        `无法为可写目录临时降级完整性标签（${grants.failures
          .map((failure) => `${failure.dir}: ${failure.error}`)
          .join('; ')}）`,
        config.failClosed
      );
    }

    const helperPath =
      deps.winHelperPath ?? resolveWinSandboxHelperPath({ platform: 'win32' });
    return {
      command: helperPath,
      env: childEnv,
      args: buildWinSandboxArgv({
        program: exe,
        args: input.args,
        // 0 = 不限时（helper 的 INFINITE 分支）；单次执行超时由 `executeCode` 兜底
        timeoutMs: 0,
      }),
      mode: 'windows-low-il',
      reason: 'windows-low-il',
      release: grants.release,
    };
  }

  return unavailable(
    input,
    'platform-unsupported',
    `当前平台（${platform}）没有可用的写隔离后端`,
    config.failClosed
  );
}

/** `mode='refuse'` ⇒ 抛出可操作的 fail-closed 错误（与 bash 的拒绝同形） */
export function assertReplSandboxPlanUsable(plan: ReplSandboxPlan): void {
  if (plan.mode !== 'refuse') return;
  throw new AppError(
    plan.message ?? 'REPL 沙箱无法生效，已按 fail-closed 拒绝启动',
    ErrorCategory.EXECUTION,
    ErrorSeverity.HIGH,
    'SG1_REPL_SANDBOX_UNENFORCEABLE'
  );
}

/** 会话启动时的归一化日志（成功/降级都留痕，避免"以为隔离了"） */
export function logReplSandboxPlan(plan: ReplSandboxPlan): void {
  if (plan.mode === 'none') {
    logger.warn('repl: sandbox_not_enforced', {
      reason: plan.reason,
      warning: plan.warning,
    });
    return;
  }
  logger.info('repl: sandbox_enforced', {
    mode: plan.mode,
    reason: plan.reason,
  });
}
