/**
 * CodeRunner Linux landlock 执行器（CM-3a；**G1-A2 接入配置** 2026-09-26）
 *
 * 复用 wrapper（公共层，与 CM-3b 同一 wrapper 保证两平台 API 面一致），
 * 进程隔离手段用 landlock-run（Linux）：
 *   landlock-run <policy args> -- /bin/sh -c "<bun> run wrapper.ts user.ts"
 *
 * 最小 bun 执行 policy（评审建议 1，P0 + 三轮 P0-1）：
 *   - bun 解释器路径 --ro
 *   - 运行目录（wrapper/user.ts/产物）--rw
 *   - ~/.bun 缓存 --rw（bun 首次运行写缓存，未放行会沙箱内启动失败）
 *   - /tmp --rw、/proc --ro（bun 运行时临时文件/运行时读取）
 *   - `--net-deny`（**网络全禁**：handle 全部 net 权限且不授予任何规则）
 *
 * 不可用（非 Linux / LSM 未启用 / helper 缺失）→ 返回 null，调用方降级到跨平台执行器。
 * 平台差异仅在进程隔离手段（landlock vs 无），API 面一致（五轮评审 P1-4）。
 *
 * **G1-A2（2026-09-26）修复的"名义契约"**：`sandbox.landlock.enabled` / `failClosed` 此前
 * **无任何消费者**（实测：`readLandlockConfig()` 全仓除自身与桶导出外零命中）⇒
 * `enabled=false` 拦不住本路径、`failClosed=true` 也不生效。现接入：
 * - `enabled === false` ⇒ 直接走跨平台执行器（配置语义"关闭则完全走本地执行路径"）；
 * - 能力不可用 / helper 初始化失败（exit 125）⇒ 由 `failClosed` 决定**拒绝**还是**降级**，
 *   且拒绝时给出**可操作**信息（不静默降级到无约束执行）。
 */

import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { homedir } from 'os';

import {
  LandlockDetector,
  buildLandlockArgv,
  isSandboxInitFailure,
  readLandlockConfig,
  processRegistry,
} from '@modules/sandbox';
import type {
  LandlockCapability,
  LandlockConfig,
  LandlockPolicy,
} from '@modules/sandbox';
import { getLogger } from '@modules/monitoring';

import {
  prepareRunDir,
  runRpcChildProcess,
  type CodeRunnerExecOptions,
} from './CrossPlatformRunner';
import type { CodeRunResult } from './types';

const logger = getLogger('tools:CodeRunner:landlock');

/** landlock-run helper（环境变量可覆盖，默认 PATH 查找） */
const LANDLOCK_HELPER = process.env.LANDLOCK_RUN_HELPER || 'landlock-run';

/**
 * 构造最小 bun 执行 policy（CM-3a）。
 *
 * `net: { denyAll: true }`（2026-09-29 台账 **D-36-① / D-38** 修复）：本模块的注释意图一直是
 * "网络全禁"，但原实现**不传任何网络参数** —— 而 Landlock 的语义是"**未 handle 即不受限**"
 * ⇒ 实际得到的是**网络完全不受限**（与注释相反，属**安全缺口**）。"全禁"的正确写法是
 * **handle 全部 net 权限且不加任何规则**，由 helper 的 `--net-deny` 表达。
 *
 * 导出仅供离线断言策略形状（生产消费者只有下方 `runCodeRunnerWithLandlock`）。
 */
export function buildBunLandlockPolicy(
  runDir: string,
  abi: number
): LandlockPolicy {
  const fs: LandlockPolicy['fs'] = [
    // bun 解释器（只读+执行）
    { path: dirname(process.execPath), allow: ['read', 'execute'] },
    // 运行目录（wrapper/user.ts/产物）——可写
    {
      path: runDir,
      allow: ['read', 'write', 'execute', 'make_dir', 'make_reg', 'refer'],
    },
    // bun 缓存（首次运行写 ~/.bun）
    {
      path: join(homedir(), '.bun'),
      allow: ['read', 'write', 'make_dir', 'make_reg', 'refer'],
    },
    // /tmp：bun 运行时临时文件
    {
      path: '/tmp',
      allow: ['read', 'write', 'make_dir', 'make_reg', 'remove', 'refer'],
    },
    // /proc：bun 运行时读取
    { path: '/proc', allow: ['read'] },
  ];
  // 网络**全禁**（见上方注释：未 handle 即不受限 ⇒ 必须显式 handle 全部 net 权限且不授予）
  return { cwd: runDir, fs, net: { denyAll: true }, abi };
}

/** 门控判定（**纯函数**，便于离线逐分支覆盖） */
export interface CodeRunnerLandlockGate {
  mode: 'landlock' | 'plain' | 'refuse';
  reason:
    | 'master-off'
    | 'platform-unsupported'
    | 'capability-unavailable'
    | 'enabled';
  /** `refuse` 时的可操作说明 */
  message?: string;
}

/**
 * 开关 / 平台 / 能力 → 走哪条路径（**零 IO**）。
 *
 * - `plain`：`enabled=false`、非 Linux、或能力不可用但 `failClosed=false` ⇒ 跨平台执行器（**既有降级路径**）；
 * - `landlock`：真受限；
 * - `refuse`：能力不可用且 `failClosed=true` ⇒ **拒绝**（不静默降级到无约束执行）。
 *
 * ⚠️ **非 Linux 判 `plain` 而非 `refuse`**：`failClosed` 的字面语义是"**沙箱初始化失败**（exit 125）时
 * 拒绝而非回退"，而"非 Linux 平台"是**设计内的正常分支**（跨平台执行器是合法执行器，见文件头 P1-4）。
 * 若在非 Linux 上因 `failClosed=true` 就拒绝，会把 Windows/macOS 的 `code_run` 直接打死 ——
 * 而该开关**此前无消费者**、从未有过这层语义，属会惊吓用户的隐性行为变更。
 */
export function decideCodeRunnerLandlock(input: {
  config: LandlockConfig;
  platform: NodeJS.Platform;
  capability: LandlockCapability | null;
}): CodeRunnerLandlockGate {
  const { config, platform, capability } = input;
  if (!config.enabled) return { mode: 'plain', reason: 'master-off' };
  if (platform !== 'linux') {
    return { mode: 'plain', reason: 'platform-unsupported' };
  }
  if (!capability?.available) {
    if (config.failClosed) {
      return {
        mode: 'refuse',
        reason: 'capability-unavailable',
        message:
          `已开启 sandbox.landlock.failClosed，但本机 Landlock 不可用（原因：${capability?.reason ?? '未知'}）` +
          `⇒ 拒绝执行 code_run，而不是降级到无内核级约束的执行。` +
          `请安装 landlock-run helper（或设置 LANDLOCK_RUN_HELPER）并使用支持 Landlock 的内核，或关闭该开关。`,
      };
    }
    return { mode: 'plain', reason: 'capability-unavailable' };
  }
  return { mode: 'landlock', reason: 'enabled' };
}

/** 构造"拒绝执行"的结果（`security-rejected` = 不进迭代，语义见 `types.ts`） */
export function landlockRefusalResult(message: string): CodeRunResult {
  return {
    status: 'security-rejected',
    error: message,
    logs: [],
    toolCalls: [],
    durationMs: 0,
  };
}

/** helper 初始化失败（exit 125）的处置：原样返回 / 换成拒绝 / 降级 */
export type SandboxInitFailureAction =
  | { action: 'keep' }
  | { action: 'refuse'; refusal: CodeRunResult }
  | { action: 'fallback' };

/**
 * 把"沙箱初始化失败"（**唯一权威信号 = exit 125**，见 `isSandboxInitFailure`）按 `failClosed` 分流。
 *
 * 判据用**真实退出码**而非 `error` 文案 —— 后者是字符串匹配做状态判断（CS02）。
 */
export function resolveSandboxInitFailure(input: {
  config: LandlockConfig;
  result: CodeRunResult;
}): SandboxInitFailureAction {
  if (!isSandboxInitFailure(input.result.exitCode ?? -1)) {
    return { action: 'keep' };
  }
  if (input.config.failClosed) {
    return {
      action: 'refuse',
      refusal: {
        ...input.result,
        status: 'security-rejected',
        error:
          `Landlock 沙箱初始化失败（exit 125；sandbox.landlock.failClosed=true）⇒ 拒绝执行 code_run，` +
          `不降级到无约束执行。请检查 landlock-run helper 与内核，或关闭该开关。` +
          `原始信息：${input.result.error ?? '（无）'}`,
      },
    };
  }
  return { action: 'fallback' };
}

/**
 * 在 landlock 域中执行编排代码。
 * @returns 执行结果；应改走跨平台执行器时返回 `null`（调用方降级）
 */
export async function runCodeRunnerWithLandlock(
  opts: CodeRunnerExecOptions
): Promise<CodeRunResult | null> {
  const config = readLandlockConfig();
  // 总开关关闭 ⇒ 连探测都不做（配置语义："关闭则完全走本地执行路径"）
  if (!config.enabled) {
    logger.debug(
      'landlock disabled by config, cross-platform runner takes over'
    );
    return null;
  }

  const cap = await LandlockDetector.detect({ helperPath: LANDLOCK_HELPER });
  const gate = decideCodeRunnerLandlock({
    config,
    platform: process.platform,
    capability: cap,
  });

  if (gate.mode === 'plain') {
    logger.debug('landlock not used, cross-platform runner takes over', {
      reason: gate.reason,
      capability: cap.reason,
    });
    return null;
  }
  if (gate.mode === 'refuse') {
    logger.warn(
      'landlock 被强制要求但不可用 ⇒ 拒绝 code_run（failClosed=true）',
      {
        reason: gate.reason,
        capability: cap.reason,
      }
    );
    return landlockRefusalResult(
      gate.message ?? 'Landlock 不可用，已按 failClosed 拒绝执行'
    );
  }

  const { runDir, wrapperPath } = await prepareRunDir(opts);
  const policy = buildBunLandlockPolicy(runDir, cap.abi);
  const argv = [
    ...buildLandlockArgv(policy),
    '--',
    '/bin/sh',
    '-c',
    `"${process.execPath}" run "${wrapperPath}" user.ts`,
  ];

  const child = spawn(LANDLOCK_HELPER, argv, {
    cwd: runDir,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // S7（2026-10-09）：登记进 `ProcessRegistry`（点亮 `GET /v1/sandbox/status` 的 `processStats`；
  // 原 `register()` 全仓零调用 ⇒ 恒空）。本路径为**异步** RPC 子进程 ⇒ 先记 `running`，
  // 由 `close` 事件收敛为终态（与 bash 的"返回即终态"不同）。
  const processEntryId =
    child.pid === undefined
      ? undefined
      : processRegistry.register({
          pid: child.pid,
          command: 'code_run',
          status: 'running',
          metadata: { source: 'code_run' },
        });
  child.on('close', (code) => {
    if (processEntryId === undefined) return;
    processRegistry.updateStatus(
      processEntryId,
      (child as { killed?: boolean }).killed ? 'timed_out' : 'completed',
      code ?? undefined
    );
  });

  const result = await runRpcChildProcess(child, {
    bridge: opts.bridge,
    timeoutMs: opts.timeoutMs,
  });

  const initFailure = resolveSandboxInitFailure({ config, result });
  if (initFailure.action === 'refuse') return initFailure.refusal;
  if (initFailure.action === 'fallback') {
    logger.warn(
      'landlock 沙箱初始化失败（exit 125）⇒ 按 failClosed=false 降级跨平台执行器',
      { detail: result.error }
    );
    return null;
  }
  return result;
}

/**
 * 执行编排代码（安全选择器）：Linux + landlock 可用 → landlock；否则跨平台。
 */
export async function runCodeRunnerSafely(
  opts: CodeRunnerExecOptions
): Promise<CodeRunResult> {
  const landlockResult = await runCodeRunnerWithLandlock(opts);
  if (landlockResult) return landlockResult;
  const { runCodeRunner } = await import('./CrossPlatformRunner');
  return runCodeRunner(opts);
}
