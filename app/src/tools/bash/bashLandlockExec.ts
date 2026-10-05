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
 * G1-A（2026-09-26，《Liri 优化方案》G 组 **选项 A**）：**bash 接入 Landlock**。
 *
 * **背景**：`code_run` 早已经 `landlock-run` 在 Landlock 域内执行（`LinuxSandboxRunner`），
 * 而 `bash` 只有**事前静态黑名单**（`SandboxSecurityChecker`）⇒ Linux 上 bash 无内核级约束。
 * 本模块把 bash 执行接到同一套 Landlock 设施上（`buildLandlockArgv` + `appendWithinLimit` +
 * `readLandlockConfig` 全部复用，**不新造**策略/截断/配置面）。
 *
 * **默认关闭**（`sandbox.landlock.bashEnabled=false`）：bash 是交互式通道，FS 白名单一旦漏声明
 * 用户需要的路径就会**拦掉正常命令**（方案 §4 G1 点名的"误伤"）⇒ 由用户显式开启。
 *
 * **开启后的语义（关键，避免"假受限"）**：
 * - 显式开启却**无法真正受限**（非 Linux / 本机 Landlock 不可用）⇒ **拒绝执行**（fail-closed，
 *   B2 同取向："不假装已受限"），错误信息给出可操作的两条出路（关开关 / 换环境）；
 * - helper 初始化失败（exit 125）⇒ 由既有 `failClosed` 决定：`true` 拒绝、`false` 回退普通执行并 WARN；
 * - 命令本身非 0 退出 ⇒ 与原来的 `exec` 路径**同形**（抛错、带出 `stderr`/`code`）。
 *
 * **本项只补"文件系统写"的内核级约束；网络保持"不受限"**（2026-09-29 台账 D-36-①/D-38 更正）：
 * 原实现传 `net.allow = connect_tcp/udp`（意图"放行"）⇒ 经 `--net-connect` 落到内核后实际是
 * **拒绝**该协议 CONNECT（Landlock 语义：handle 即默认拒绝，且该 flag 从不加 net 授权规则）⇒
 * 反而**制造**了它想避免的误伤（`curl`/`git`/`npm` 失败）。而"按任意端口放行 CONNECT"在内核层面
 * **无法表达**（net 规则只能授**具体端口**，`port 0` 只表示 ephemeral）⇒ 正确形态是**根本不 handle
 * 网络**（不设 `net`），内核即视为不受限。另：原实现**无条件**请求 `connect_udp`，在 ABI < 10 的
 * 内核上会让 helper 直接 **exit 125**（"requested NET access beyond kernel ABI"）⇒ 该问题随
 * "不传网络参数"一并消失。
 *
 * ✅ **真机已验（2026-10-05，WSL2）**：门控路由（`eval-forced ⇒ landlock`）与敏感路径拒绝均正确、
 * 普通命令**无误拒**。**缺口②已处置**：WSL2 域内 DNS 曾因 `/etc/resolv.conf` 的符号链接目标
 * （`/mnt/wsl/resolv.conf`）不在白名单而被拒（`curl: (6) Could not resolve host`）⇒ 现**声明**只读
 * 放行 `/mnt/wsl`，并由 `buildLandlockArgv` 的**统一存在性过滤**在路径缺失时丢弃（非 WSL 环境）。
 * 离线用例覆盖门控判据、策略形状、argv 形状与成败分支。
 */

import { exec, spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { getLogger } from '@modules/monitoring';
import {
  appendWithinLimit,
  buildLandlockArgv,
  isSandboxInitFailure,
  LandlockDetector,
  readLandlockConfig,
  isEvalBashLandlockForced,
} from '@modules/sandbox';
import type {
  LandlockCapability,
  LandlockConfig,
  LandlockFsAccess,
  LandlockFsRule,
  LandlockPolicy,
} from '@modules/sandbox';
import {
  resolveDownloadsDir,
  resolveOutputDir,
  resolveTempDir,
} from '@modules/core/paths';
import { reportBashLandlockGapOnce } from './bashLandlockGap';

const logger = getLogger('tools:bash:landlock-exec');

const execAsync = promisify(exec);

/** landlock-run helper（与 `LinuxSandboxRunner` **同一个**环境变量，不新增命名） */
const BASH_LANDLOCK_HELPER = process.env.LANDLOCK_RUN_HELPER || 'landlock-run';

const FS_READ_EXECUTE: LandlockFsAccess[] = ['read', 'execute'];
const FS_READ_WRITE: LandlockFsAccess[] = [
  'read',
  'write',
  'execute',
  'make_dir',
  'make_reg',
  'remove',
  'refer',
];

/**
 * 只读系统路径。
 *
 * ⚠️ Landlock 是**白名单**：未声明的路径**连读都不行** ⇒ 漏一个就会让 shell 自身起不来
 * （`/bin/sh` 在 `/bin`、动态库在 `/lib`…）。故这一列**宁可多列**；它并不降低安全性 ——
 * Landlock 只做限制、不提权，仍受 POSIX 权限约束。
 */
const SYSTEM_READ_EXECUTE_PATHS = [
  '/usr',
  '/bin',
  '/sbin',
  '/lib',
  '/lib32',
  '/lib64',
  '/etc',
  '/opt',
  '/proc',
  '/sys',
  '/run',
  '/var',
] as const;

/**
 * 构造 bash 的 Landlock 策略（**纯函数**，便于离线断言形状）。
 *
 * 写权限只给：工作区（cwd）、受管输出/下载/临时目录、`/tmp` 与 `/var/tmp`、常见工具缓存、
 * `/dev`（允许 `2>/dev/null` 这类常规重定向）。
 *
 * 🔒 **`~/.pyapp` 整棵目录树一律不放行**（P0-3-a，2026-09-28）。此前这里是一条
 * `{ path: pyappHome, allow: FS_READ_EXECUTE }`（"只读"）—— 但该目录下**几乎全是敏感内容**：
 * `config.json` / `credentials.json`（凭据）、`data/app.db`（全部会话与台账）、`sessions/`、
 * `memory/`、`knowledge/`、`logs/`、`mcp/`（可能含服务器凭据）、`permissions/`、`settings/`、
 * `snapshots/`、`backups/` …（实测顶层 **25 个目录 + 6 个文件**）。
 * ⇒ "只读"挡得住**改**，挡不住**读**，而读走凭据与会话数据同样是泄露；且 Landlock 无法表达
 * "父目录允许、子目录排除"，逐项枚举非敏感项的净收益为负（敏感项占绝大多数）⇒ **整条移除**是唯一合理形态。
 *
 * **功能面不受影响（有取证，见 `dev_docs/20260926/liri-optimization-plan-20260926.md` 的 P0-3）**：
 * ① 受管产物目录 `output` / `downloads` / `temp` **已单独以读写列出**（它们是 `~/.pyapp` 下的
 *    **具体子路径**，不受本次移除影响）；② 项目内**无内建 bash 命令**需要读 `~/.pyapp`
 *    —— `execBashCommand` 的唯一调用点是 `BashTool.execute`，命令来自用户/模型；
 * ③ 技能按 `project_rules.md §1.15` **仅提示词注入、禁止 shell 执行** ⇒ 无"读 `skills/` 跑脚本"场景；
 * ④ 工具链缓存（`~/.bun` / `~/.npm` / `~/.cache`）与 cwd 均已单独放行。
 */
export function buildBashLandlockPolicy(input: {
  cwd: string;
  abi: number;
  homeDir?: string;
  /**
   * §3-2（2026-10-05 治理）：用户显式声明的**额外可写路径**
   * （`sandbox.landlock.bashExtraWritablePaths`）。缺省 `[]` ⇒ 与治理前策略逐条等价。
   */
  extraWritablePaths?: string[];
}): LandlockPolicy {
  const homeDir = input.homeDir ?? homedir();

  const fs: LandlockFsRule[] = [
    ...SYSTEM_READ_EXECUTE_PATHS.map((path) => ({
      path,
      allow: FS_READ_EXECUTE,
    })),
    // `/dev`：可写（`2>/dev/null`、`>&2` 等常规重定向；只限制不提权，故无额外风险）
    { path: '/dev', allow: FS_READ_WRITE },
    // 工作区
    { path: input.cwd, allow: FS_READ_WRITE },
    // 受管目录（AI 产物落点）
    { path: resolveOutputDir(), allow: FS_READ_WRITE },
    { path: resolveDownloadsDir(), allow: FS_READ_WRITE },
    { path: resolveTempDir(), allow: FS_READ_WRITE },
    // 临时区 + 常见工具缓存（bash 里跑 git/npm/bun 需要写缓存）
    { path: '/tmp', allow: FS_READ_WRITE },
    { path: '/var/tmp', allow: FS_READ_WRITE },
    { path: join(homeDir, '.bun'), allow: FS_READ_WRITE },
    { path: join(homeDir, '.npm'), allow: FS_READ_WRITE },
    { path: join(homeDir, '.cache'), allow: FS_READ_WRITE },
    // 缺口②（2026-10-05 WSL2 真机）：域内 DNS 依赖 `/etc/resolv.conf` → `/mnt/wsl/resolv.conf`，
    // 而该符号链接**目标**不在任何其它白名单内 ⇒ 只读放行 `/mnt/wsl`（WSL 内部挂载，通常只含
    // resolv.conf 等只读配置，扩面极小）。
    // 此处**无条件声明**：非 WSL 环境该路径不存在，由 `buildLandlockArgv` 的**存在性过滤**统一丢弃
    // （否则 helper 对缺失路径 exit 125，整只沙箱失效）。
    { path: '/mnt/wsl', allow: FS_READ_EXECUTE },
    // §3-2（2026-10-05）：用户声明的额外可写路径（默认空 ⇒ 策略与治理前逐条等价）。
    // 缺失路径由 `buildLandlockArgv` 的存在性过滤统一丢弃（与上列各条同一机制）。
    ...(input.extraWritablePaths ?? []).map((path) => ({
      path,
      allow: FS_READ_WRITE,
    })),
  ];

  return {
    cwd: input.cwd,
    fs,
    // **不设 `net`** ⇒ 不传网络参数 ⇒ 内核不 handle 网络 ⇒ **不受限**（bash 从来不是网络受限通道）。
    // ⚠️ 不可写成 `{ denyAll: true }`（那会真的禁网、误伤 curl/git/npm）。见 types.ts 的 LandlockNetRule。
    abi: input.abi,
  };
}

/** 门控判定结果（`refuse` 时 `message` 必填，供用户可操作地排障） */
export interface BashLandlockGate {
  mode: 'plain' | 'landlock' | 'refuse';
  reason:
    | 'master-off'
    | 'switch-off'
    | 'platform-unsupported'
    | 'capability-unavailable'
    | 'eval-forced'
    | 'eval-forced-fallback'
    | 'enabled';
  message?: string;
}

/**
 * 纯判据：开关 / 平台 / 能力 → 走哪条路径（**零 IO**）。
 *
 * 三类结果：`plain`（开关关闭，走原路径）、`landlock`（真受限）、`refuse`（**开启但无法受限** ⇒ 拒绝）。
 *
 * P0-4 ②（2026-10-04）：`evalForced=true` 时走**评测期强制**分支 —— **capability-gated**：
 *   能力可用 ⇒ `landlock`；不可用 ⇒ **`plain`（回退，绝不 `refuse`）**，避免打断非 Linux 评测。
 *   ⚠️ 需 Linux 真实评测运行验证（开启后受 FS 白名单约束，须确认不误拒）。
 */
export function decideBashLandlockGate(input: {
  config: LandlockConfig;
  platform: NodeJS.Platform;
  capability: LandlockCapability | null;
  /** P0-4 ②：评测期**请求**强制（见 `sandbox/landlock/config.ts` 的 `ENV_EVAL_BASH_LANDLOCK`） */
  evalForced?: boolean;
}): BashLandlockGate {
  const { config, platform, capability, evalForced = false } = input;

  if (!config.enabled) return { mode: 'plain', reason: 'master-off' };

  // P0-4 ②（2026-10-04）：评测期强制 —— capability-gated；不可用**回退 plain**（不 refuse）
  if (evalForced) {
    if (platform === 'linux' && capability?.available) {
      return { mode: 'landlock', reason: 'eval-forced' };
    }
    return { mode: 'plain', reason: 'eval-forced-fallback' };
  }

  if (!config.bashEnabled) return { mode: 'plain', reason: 'switch-off' };

  if (platform !== 'linux') {
    return {
      mode: 'refuse',
      reason: 'platform-unsupported',
      message:
        `已开启 sandbox.landlock.bashEnabled，但当前平台（${platform}）不支持 Landlock（仅 Linux 内核 5.13+）。` +
        `为保证"开启即真受限"，本次命令被拒绝执行，而不是静默降级。` +
        `请关闭该开关（config.json 的 sandbox.landlock.bashEnabled），或改在 Linux 上运行。`,
    };
  }

  if (!capability?.available) {
    return {
      mode: 'refuse',
      reason: 'capability-unavailable',
      message:
        `已开启 sandbox.landlock.bashEnabled，但本机 Landlock 不可用（原因：${capability?.reason ?? '未知'}）。` +
        `为保证"开启即真受限"，本次命令被拒绝执行，而不是静默降级。` +
        `请安装 landlock-run helper（或设置 LANDLOCK_RUN_HELPER）并使用支持 Landlock 的内核，或关闭该开关。`,
    };
  }

  return { mode: 'landlock', reason: 'enabled' };
}

export interface LandlockHelperRunInput {
  helperPath: string;
  argv: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  /** 输出硬上限（**按字符**比较，与 B1 / PTY 同口径） */
  maxBufferChars: number;
}

export interface LandlockHelperResult {
  stdout: string;
  stderr: string;
  /** `null` = 未取到退出码（spawn 失败 / 被杀 / 超时） */
  exitCode: number | null;
  timedOut: boolean;
  error?: Error;
}

/** helper 执行器（**可注入**：离线测试无需 Linux） */
export type LandlockHelperRunner = (
  input: LandlockHelperRunInput
) => Promise<LandlockHelperResult>;

/**
 * 默认 helper 执行器：`spawn` + 逐块按剩余量切片（硬上限防 OOM）。
 *
 * **异步**（不得用 `execSync`：daemon 内同步阻塞会让全部 HTTP/SSE 停摆，见 B3-a）。
 */
export const defaultLandlockHelperRunner: LandlockHelperRunner = ({
  helperPath,
  argv,
  cwd,
  env,
  timeoutMs,
  maxBufferChars,
}) =>
  new Promise<LandlockHelperResult>((resolve) => {
    const child = spawn(helperPath, argv, {
      cwd,
      env,
      timeout: timeoutMs,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (block: Buffer) => {
      stdout = appendWithinLimit(stdout, block.toString(), maxBufferChars).text;
    });
    child.stderr.on('data', (block: Buffer) => {
      stderr = appendWithinLimit(stderr, block.toString(), maxBufferChars).text;
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      resolve({
        stdout,
        stderr: stderr ? `${stderr}\n${String(error)}` : String(error),
        exitCode: null,
        timedOut: false,
        error,
      });
    });
    child.on('close', (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code,
        timedOut: !!(child as { killed?: boolean }).killed,
      });
    });
  });

/** 普通（非 Landlock）执行器签名；**导出**以便调用方/测试注入替身 */
export type PlainRunner = (
  command: string,
  options: {
    cwd?: string;
    env: NodeJS.ProcessEnv;
    timeout: number;
    maxBuffer: number;
  }
) => Promise<{ stdout: string; stderr: string }>;

/** 原路径执行器（顶层 `exec`，行为与改造前一致） */
const defaultPlainRunner: PlainRunner = async (command, options) => {
  const { stdout, stderr } = await execAsync(command, {
    cwd: options.cwd,
    env: options.env,
    timeout: options.timeout,
    maxBuffer: options.maxBuffer,
  });
  return { stdout: String(stdout), stderr: String(stderr) };
};

export interface BashExecDeps {
  config?: LandlockConfig;
  /** P0-4 ②：评测期强制（默认读 env；测试可注入） */
  evalForced?: boolean;
  platform?: NodeJS.Platform;
  detect?: () => Promise<LandlockCapability>;
  runHelper?: LandlockHelperRunner;
  runPlain?: PlainRunner;
  helperPath?: string;
  /** 规则路径存在性判定（默认 `fs.existsSync`，见 `buildLandlockArgv`）；测试可注入 */
  pathExists?: (path: string) => boolean;
}

export interface BashExecInput {
  command: string;
  cwd?: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxBufferChars: number;
  deps?: BashExecDeps;
}

/** 非 0 退出时构造与 `exec` **同形**的错误（调用方按 `stderr`/`code` 归因） */
function commandFailedError(input: {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}): Error {
  const error = new Error(
    `Command failed: ${input.command}${input.stderr ? `\n${input.stderr}` : ''}`
  );
  const enriched = error as Error & {
    code?: number;
    stderr?: string;
    stdout?: string;
  };
  enriched.code = input.exitCode;
  enriched.stderr = input.stderr;
  enriched.stdout = input.stdout;
  return error;
}

/**
 * **bash 执行的唯一收敛入口**（G1-A）。
 *
 * 开关关闭 ⇒ 与改造前的 `exec` 路径等价（并保留 G1-C 的顾问性提示）；
 * 开关开启 ⇒ Landlock 域内执行，且"无法受限就拒绝"（见模块头注释）。
 */
export async function execBashCommand(
  input: BashExecInput
): Promise<{ stdout: string; stderr: string }> {
  const deps = input.deps ?? {};
  const config = deps.config ?? readLandlockConfig();
  const runPlain = deps.runPlain ?? defaultPlainRunner;
  const plainOptions = {
    cwd: input.cwd,
    env: input.env,
    timeout: input.timeoutMs,
    maxBuffer: input.maxBufferChars,
  };

  // P0-4 ②：评测期强制请求（env 置位；capability 门控在下面的 gate）
  const evalForced = deps.evalForced ?? isEvalBashLandlockForced();
  if (!config.enabled || (!config.bashEnabled && !evalForced)) {
    // G1-C（选项 C）的顾问性提示：能力可用却未接入时 WARN 一次
    await reportBashLandlockGapOnce();
    return runPlain(input.command, plainOptions);
  }

  const platform = deps.platform ?? process.platform;
  // 非 Linux 不探测（避免无谓 IO）；capability 留 null ⇒ 判据给出 refuse
  const capability =
    platform === 'linux'
      ? await (
          deps.detect ??
          (() =>
            LandlockDetector.detect({
              helperPath: deps.helperPath ?? BASH_LANDLOCK_HELPER,
            }))
        )()
      : null;
  const gate = decideBashLandlockGate({
    config,
    platform,
    capability,
    evalForced,
  });

  // P0-4 ②：评测期强制但能力不可用 ⇒ **回退 plain**（非 refuse）
  if (gate.mode === 'plain') {
    await reportBashLandlockGapOnce();
    return runPlain(input.command, plainOptions);
  }

  if (gate.mode === 'refuse') {
    // fail-closed：显式开启却无法受限 ⇒ 拒绝执行（**不**静默降级）
    throw new AppError(
      gate.message ?? 'Landlock 无法生效，已按 fail-closed 拒绝执行',
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      'G1A_LANDLOCK_UNENFORCEABLE'
    );
  }

  const helperPath = deps.helperPath ?? BASH_LANDLOCK_HELPER;
  const policy = buildBashLandlockPolicy({
    cwd: input.cwd ?? process.cwd(),
    abi: capability?.abi ?? 0,
    extraWritablePaths: config.bashExtraWritablePaths,
  });
  const result = await (deps.runHelper ?? defaultLandlockHelperRunner)({
    helperPath,
    argv: [
      ...buildLandlockArgv(policy, deps.pathExists),
      '--',
      '/bin/sh',
      '-c',
      input.command,
    ],
    cwd: input.cwd,
    env: input.env,
    timeoutMs: input.timeoutMs,
    maxBufferChars: input.maxBufferChars,
  });

  if (isSandboxInitFailure(result.exitCode ?? -1)) {
    if (config.failClosed) {
      throw new AppError(
        `Landlock 沙箱初始化失败（exit 125；failClosed=true）⇒ 拒绝执行：${result.stderr.slice(0, 500)}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'G1A_LANDLOCK_INIT_FAILED'
      );
    }
    logger.warn(
      'Landlock 沙箱初始化失败（exit 125）⇒ 按 failClosed=false 回退普通执行',
      { detail: result.stderr.slice(0, 300) }
    );
    return runPlain(input.command, plainOptions);
  }

  if (result.error || result.exitCode === null) {
    throw (
      result.error ??
      new Error(`Command failed: ${input.command}（未取到退出码）`)
    );
  }
  if (result.exitCode !== 0) {
    throw commandFailedError({
      command: input.command,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    });
  }
  return { stdout: result.stdout, stderr: result.stderr };
}
