/**
 * PowerShell 工具的 Windows 写隔离接入（2026-11-07，方案 §10.5 遗留项）
 *
 * 与 bash **共用同一套**机制：
 *  - 开关：`sandbox.landlock.bashEnabled`（Windows 上「命令执行写隔离」对 bash / powershell 同开同关）；
 *  - 授权：`bashWindowsSandbox.runWithWindowsWriteIsolation`（临时降完整性标签 + 授权台账 + WO 进程内复用）；
 *  - 执行：`win-sandbox-run.exe`（Low IL + Job Object）；
 *  - 失败语义：`sandbox.landlock.failClosed` 决定「拒绝」还是「降级普通执行」。
 *
 * 为什么需要：`PowerShellTool` 的白名单含 `New-Item` / `Copy-Item` / `Move-Item` / `Out-File`
 * 等**写**动词，而它原先是 `exec('pwsh …')` 直接起进程 ⇒ 打开 bash 写隔离后，powershell 仍能
 * 不受限写盘（沙箱旁路，取证见方案 §10.5）。
 *
 * 只做**写**隔离：读与网络不受限（与 bash 同口径）。
 */
import { exec } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { promisify } from 'node:util';
import {
  resolveDownloadsDir,
  resolveOutputDir,
  resolveTempDir,
} from '@openliri/infra/environment';
import { getLogger } from '@openliri/infra/monitoring';
import { readLandlockConfig } from '@modules/sandbox';
// 与 bash 同一输出上限（16MB），避免 powershell 侧再写一份常量
import { BASH_EXEC_MAX_BUFFER_BYTES } from '../bash/bashOutputTruncate';
import {
  isWindowsAccessDenied,
  runWithWindowsWriteIsolation,
  type WindowsWriteIsolationDeps,
} from '../bash/bashWindowsSandbox';
import type { WinSandboxRunResult } from '@modules/sandbox';

const logger = getLogger('tools:PowerShellTool:sandbox');
const execAsync = promisify(exec);

export interface PowerShellInvocation {
  /** 目标程序（`pwsh`；helper 直接 CreateProcess 它，不经 cmd） */
  program: string;
  args: string[];
  /** 未走沙箱时的完整命令行（与原 `exec('pwsh …')` 逐字一致） */
  commandLine: string;
}

/**
 * 构建 `pwsh` 调用（argv + 未沙箱时的命令行）。
 *
 * 用 `-EncodedCommand` 而不是 `-Command`：`child_process.exec` 在 Windows 上经
 * `cmd.exe /d /s /c` 执行，cmd 与 PowerShell 的引号转义规则不同 ⇒ 含双引号/中文的路径会被解析错。
 * Base64 完全绕过引号层，支持任意 Unicode。
 */
export function buildPowerShellInvocation(
  command: string,
  executionPolicy: string,
  depth?: number,
  exclude?: string
): PowerShellInvocation {
  let finalCommand = command;

  // 追加 depth 限制：通过 Select-Object -First 限制输出对象数
  if (depth !== undefined && depth > 0) {
    finalCommand += ` | Select-Object -First ${depth}`;
  }

  // 追加 exclude 过滤：通过 Select-String 排除匹配行
  if (exclude) {
    // 转义单引号防止命令注入
    const escapedExclude = exclude.replace(/'/g, "''");
    finalCommand += ` | Select-String -NotMatch -SimpleMatch '${escapedExclude}'`;
  }

  const encoded = Buffer.from(finalCommand, 'utf16le').toString('base64');
  const args = [
    '-NoProfile',
    '-ExecutionPolicy',
    executionPolicy,
    '-EncodedCommand',
    encoded,
  ];
  return {
    program: 'pwsh',
    args,
    commandLine: `pwsh ${args.join(' ')}`,
  };
}

export interface PowerShellRunInput {
  invocation: PowerShellInvocation;
  cwd: string;
  timeoutMs: number;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  /** 注入真实 icacls / helper（离线用例不需要改真实 ACL） */
  sandboxDeps?: WindowsWriteIsolationDeps;
}

export type PowerShellRunResult =
  | { kind: 'ok'; stdout: string; stderr: string }
  /** 沙箱开启但不可用且 `failClosed=true` ⇒ 调用方按安全失败返回（不执行） */
  | { kind: 'refused'; message: string };

/** 携带 stdout/stderr 的执行错误（让 `PowerShellTool` 的 catch 能回填 stderr 末 40 行） */
function executionFailure(
  message: string,
  streams: { stdout: string; stderr: string }
): never {
  const error = new Error(message) as Error & {
    stdout?: string;
    stderr?: string;
  };
  error.stdout = streams.stdout;
  error.stderr = streams.stderr;
  throw error;
}

export type PowerShellSandboxAttempt =
  | { kind: 'plain' }
  | { kind: 'refused'; message: string }
  | { kind: 'sandboxed'; result: WinSandboxRunResult };

/**
 * 纯判据：powershell 是否应走 Windows 写隔离。
 *
 * 与 bash 门控同口径 —— 仅 Windows 且总开关 / `bashEnabled` 都开；否则维持原 `exec` 行为。
 */
export function shouldSandboxPowerShell(input: {
  platform: NodeJS.Platform;
  enabled: boolean;
  bashEnabled: boolean;
}): boolean {
  return input.platform === 'win32' && input.enabled && input.bashEnabled;
}

/** 沙箱相关配置（由调用方从 `readLandlockConfig()` 取，测试可直接构造） */
export interface PowerShellSandboxConfig {
  failClosed: boolean;
  /** 额外可写目录（与 bash 共用 `sandbox.landlock.bashExtraWritablePaths`） */
  extraWritablePaths: string[];
}

/**
 * 在 Windows 写隔离下执行（**门控与配置由调用方判定**，便于单测注入）。
 *
 * 初始化不可用（helper 缺失 / 授权失败 / helper 自身失败）⇒ 按 `failClosed` 返回 `refused` 或 `plain`。
 */
export async function runPowerShellInWindowsSandbox(
  input: PowerShellRunInput,
  config: PowerShellSandboxConfig,
  deps: WindowsWriteIsolationDeps = {}
): Promise<PowerShellSandboxAttempt> {
  // 系统 %TEMP% 是整棵大树（打标签要 60s+）⇒ 不碰它；把子进程 TEMP/TMP 指到受管临时目录
  const windowsTemp = resolveTempDir();
  try {
    mkdirSync(windowsTemp, { recursive: true });
  } catch {
    // @ignore-catch 建不出临时目录不致命：命令仍可执行，只是写 TEMP 时会被 MIC 拒绝
  }
  const env = {
    ...input.env,
    TEMP: windowsTemp,
    TMP: windowsTemp,
    TMPDIR: windowsTemp,
  };

  const startedAt = Date.now();
  const outcome = await runWithWindowsWriteIsolation(
    {
      program: input.invocation.program,
      args: input.invocation.args,
      writableDirs: [
        input.cwd,
        resolveOutputDir(),
        resolveDownloadsDir(),
        windowsTemp,
        ...config.extraWritablePaths,
      ],
      cwd: input.cwd,
      env,
      timeoutMs: input.timeoutMs,
      maxBufferChars: BASH_EXEC_MAX_BUFFER_BYTES,
      ...(input.signal ? { signal: input.signal } : {}),
    },
    deps
  );

  /** 初始化不可用：按 failClosed 决定拒绝还是降级（与 bash 同口径） */
  const initFailure = (detail: string): PowerShellSandboxAttempt => {
    if (config.failClosed) {
      return {
        kind: 'refused',
        message:
          `已开启 sandbox.landlock.bashEnabled，但 Windows 写隔离未就绪（${detail}；failClosed=true）⇒ 拒绝执行 powershell。` +
          `请运行 bun run build:win-sandbox 构建 helper，或关闭该开关。［sandbox_denied: init］`,
      };
    }
    logger.warn(
      'Windows powershell 写隔离不可用 ⇒ 按 failClosed=false 降级普通执行',
      { detail }
    );
    return { kind: 'plain' };
  };

  if (outcome.kind !== 'ran') {
    return initFailure(outcome.detail);
  }
  if (outcome.result.helperFailed) {
    return initFailure(
      outcome.result.stderr.slice(0, 300) || 'helper 退出码 126'
    );
  }

  logger.info('powershell: exec_ok', {
    mode: 'windows-low-il',
    exitCode: outcome.result.exitCode,
    durationMs: Date.now() - startedAt,
  });
  return { kind: 'sandboxed', result: outcome.result };
}

/**
 * 执行 PowerShell 命令（Windows 且开关开启时走写隔离）。
 *
 * 失败语义与原 `exec` 路径保持一致：非 0 退出码 / 超时都**抛错**，由
 * `PowerShellTool.execute` 的 catch 统一收口（分类、日志、RETRYABLE）。
 */
export async function runPowerShellCommand(
  input: PowerShellRunInput
): Promise<PowerShellRunResult> {
  // 复用 bash 的开关：不做第四个 sandbox 开关，避免「命令工具各自一套姿态」
  const config = readLandlockConfig();
  const attempt = shouldSandboxPowerShell({
    platform: process.platform,
    enabled: config.enabled,
    bashEnabled: config.bashEnabled,
  })
    ? await runPowerShellInWindowsSandbox(
        input,
        {
          failClosed: config.failClosed,
          extraWritablePaths: config.bashExtraWritablePaths,
        },
        input.sandboxDeps ?? {}
      )
    : ({ kind: 'plain' } as PowerShellSandboxAttempt);

  if (attempt.kind === 'refused') return attempt;

  if (attempt.kind === 'plain') {
    const { stdout, stderr } = await execAsync(input.invocation.commandLine, {
      cwd: input.cwd,
      timeout: input.timeoutMs,
      env: input.env,
    });
    return { kind: 'ok', stdout, stderr };
  }

  const { result } = attempt;
  if (result.timedOut) {
    // 消息带 ETIMEDOUT：与 `exec` 超时的分类口径一致（catch 里据此判 RETRYABLE）
    executionFailure(
      `Command timed out after ${input.timeoutMs}ms (ETIMEDOUT)`,
      {
        stdout: result.stdout,
        stderr: result.stderr,
      }
    );
  }
  if (result.exitCode !== 0) {
    // 写被 MIC 拒绝时如实归因（与 bash 的 `［sandbox_denied: write］` 同形）
    const suffix = isWindowsAccessDenied(result.stderr)
      ? '［sandbox_denied: write］'
      : '';
    executionFailure(
      `PowerShell 退出码 ${result.exitCode ?? 'null'}${suffix}`,
      {
        stdout: result.stdout,
        stderr: result.stderr,
      }
    );
  }

  return { kind: 'ok', stdout: result.stdout, stderr: result.stderr };
}
