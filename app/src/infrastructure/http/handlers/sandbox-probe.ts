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
 * 命令执行沙箱**只读探针**（S0，2026-11-17；设置方案 §11.1–§11.4）
 *
 * 回答一个问题：**当前配置下，命令执行会不会真的被沙箱约束？**
 * 输出 `effective`（off / plain / isolated / refuse）与可机读 `reasonCode`。
 *
 * 三条纪律（评审 P0-1 / P1-2 / P1-3）：
 * 1. **判定唯一来源** = `decideBashLandlockGate`（三档语义：master-off / switch-off /
 *    failClosed-only-on-init-failure / eval-forced 回退 plain）。本模块**不重写**判定；
 * 2. **不把"文件存在"当成"可执行"**：Linux 用 `LandlockDetector.detect()`、Windows 用
 *    helper `--probe`（2026-11-19 C 侧补齐后，`runnable` 为**实测**布尔值；
 *    helper 缺失 ⇒ `runnable=false` + `helper-missing`）；
 * 3. **覆盖范围如实写**：同一组开关也覆盖 `powershell` / `code_run`，且三平台首版
 *    **只隔离写**（读/网络不收紧）⇒ DTO 带 `coverage` / `affectedTools`。
 *
 * 分层：handler（infrastructure）经**动态导入**取 `@modules/sandbox` 与
 * `@modules/tools/bash/bashLandlockExec`（与 `session-handlers` 对 `@modules/tools`
 * 的既有做法一致），不新增静态跨层依赖，也不改动 kernel SPI 的体量预算。
 */
import { existsSync } from 'node:fs';
import type http from 'http';
import { sendError } from './handler-utils';

/** 配置视图（与 `readLandlockConfig()` 返回值同构，只取探针所需字段） */
export interface LandlockConfigView {
  enabled: boolean;
  bashEnabled: boolean;
  failClosed: boolean;
  bashExtraWritablePaths: string[];
}

/** 平台能力视图（三平台探测器的公共子集） */
export interface SandboxCapabilityView {
  available: boolean;
  reason?: string;
  path?: string;
  /** 是否存在（Windows 侧显式区分 present / runnable；Linux/macOS 缺省不下发） */
  present?: boolean;
  /** 执行探测结论（`null` = 该平台无探测契约或未探测） */
  runnable?: boolean | null;
  /** 机读原因码（Windows 侧给出 ok / helper-missing / probe-failed / probe-timeout） */
  reasonCode?: string;
}

/** 门控结果视图（与 `BashLandlockGate` 同构） */
export interface SandboxGateView {
  mode: 'plain' | 'landlock' | 'sandbox-exec' | 'windows-low-il' | 'refuse';
  reason: string;
  message?: string;
}

/** 探针结论（`GET /v1/diagnostics/sandbox/probe` 的响应体） */
export interface SandboxProbeView {
  generatedAt: string;
  platform: NodeJS.Platform;
  config: LandlockConfigView;
  /** 评测期强制（`LIRI_EVAL_BASH_LANDLOCK=1`）：能力不可用 ⇒ 回退 plain，绝不 refuse */
  evalForced: boolean;
  /** 门控原始结论（排障用；`effective` 是其归一化） */
  gate: SandboxGateView;
  effective: 'off' | 'plain' | 'isolated' | 'refuse';
  helper: {
    kind: 'landlock-run' | 'sandbox-exec' | 'win-sandbox-run' | 'none';
    /** 当前配置是否**要求** helper 生效（enabled && bashEnabled） */
    required: boolean;
    present: boolean | null;
    /** `null` = 本平台无执行探测契约（不得当成可用/不可用） */
    runnable: boolean | null;
    reasonCode: string;
    detail?: string;
    path?: string;
  };
  coverage: { write: boolean; read: boolean; network: boolean };
  affectedTools: string[];
  notes: string[];
}

/** 探针依赖（默认走真实探测；测试注入以覆盖各平台分支） */
export interface SandboxProbeDeps {
  platform: NodeJS.Platform;
  readConfig(): LandlockConfigView;
  isEvalForced(): boolean;
  detectLinux(): Promise<SandboxCapabilityView>;
  detectMac(): SandboxCapabilityView;
  detectWindows(): SandboxCapabilityView;
  linuxHelperPath(): string;
  helperExists(path: string): boolean;
  clearDetectorCaches(): void;
  decideGate(input: {
    config: LandlockConfigView;
    platform: NodeJS.Platform;
    capability: unknown;
    macCapability: unknown;
    evalForced: boolean;
  }): SandboxGateView;
}

/** 覆盖范围：三平台首版**只隔离写**（A 案 §11.4） */
const SANDBOX_COVERAGE = { write: true, read: false, network: false } as const;

/** 同一组开关的实际影响面（bash / powershell / code_run） */
const AFFECTED_TOOLS = ['bash', 'powershell', 'code_run'] as const;

/** Linux 能力原因码白名单（其余一律 `probe-failed`，不把自由文本当码） */
const LINUX_REASON_CODES = new Set([
  'no-linux',
  'not-in-lsm',
  'helper-missing',
  'probe-failed',
  'enforce-denied',
]);

/** Windows 能力原因码白名单（未知自由文本一律 `probe-failed`） */
const WIN_REASON_CODES = new Set([
  'ok',
  'helper-missing',
  'probe-failed',
  'probe-timeout',
  'not-found',
]);

/** effective 归一化（纯函数；语义见 `composeSandboxProbe` 文档） */
function resolveEffective(input: {
  config: LandlockConfigView;
  gate: SandboxGateView;
  helper: SandboxProbeView['helper'];
}): SandboxProbeView['effective'] {
  const { config, gate, helper } = input;
  if (gate.mode === 'refuse') return 'refuse';
  if (gate.mode === 'plain') {
    return gate.reason === 'master-off' ? 'off' : 'plain';
  }
  const cannotIsolate = helper.present === false || helper.runnable === false;
  if (cannotIsolate) return config.failClosed ? 'refuse' : 'plain';
  return 'isolated';
}

/**
 * 纯组装：门控结论 + helper 事实 → 探针 DTO（**零 IO、可单测**）。
 *
 * `effective` 归一化（**门控 + 可执行性事实**共同决定，不让"文件存在"冒充"真隔离"）：
 * - 门控 `refuse` ⇒ `refuse`
 * - 门控 `plain` + `reason=master-off` ⇒ `off`；其余 plain（switch-off / eval-forced-fallback）⇒ `plain`
 * - 门控要求真隔离，但 helper **缺失 / 明确不可执行** ⇒ `failClosed ? 'refuse' : 'plain'`（降级）
 *   ⚠️ Windows 的门控不看 helper（`windows-enabled`），这一层才是"缺 helper 会怎样"的如实回答；
 * - 其余 ⇒ `isolated`（Windows 的 `runnable=null` 属"未验证"，由 `helper` + `notes` 明示）
 */
export function composeSandboxProbe(input: {
  platform: NodeJS.Platform;
  config: LandlockConfigView;
  evalForced: boolean;
  gate: SandboxGateView;
  helper: SandboxProbeView['helper'];
  now?: Date;
}): SandboxProbeView {
  const { platform, config, evalForced, gate, helper } = input;
  const effective = resolveEffective(input);

  const notes: string[] = [];
  if (platform === 'win32') {
    notes.push('Windows 用 Low IL + Job Object，且只隔离写；读与网络不受限。');
  } else if (platform === 'darwin') {
    notes.push(
      'macOS 用 Seatbelt（sandbox-exec），只隔离写；能力判定只看文件是否存在（无执行探测）。'
    );
  } else if (platform === 'linux') {
    notes.push(
      'Linux 用 Landlock（内核 5.13+），只隔离写；能力经 helper --probe 实测。'
    );
  } else {
    notes.push(
      `当前平台（${platform}）不支持命令执行沙箱；开启 bashEnabled 将拒绝执行。`
    );
  }
  if (evalForced) {
    notes.push(
      '评测期强制（LIRI_EVAL_BASH_LANDLOCK=1）：能力不可用时回退 plain，绝不 refuse。'
    );
  }
  if (
    gate.mode !== 'plain' &&
    gate.mode !== 'refuse' &&
    (helper.present === false || helper.runnable === false)
  ) {
    notes.push(
      config.failClosed
        ? 'helper 缺失或不可执行，且 failClosed=true ⇒ 命令会被**拒绝执行**。'
        : 'helper 缺失或不可执行，且 failClosed=false ⇒ 已**降级为普通执行**（等于没有隔离）。'
    );
  }
  if (helper.present === true && helper.runnable === null) {
    notes.push(
      '本平台 helper 当前没有 --probe 执行契约 ⇒ runnable=null（不把"文件存在"当成"可执行"）。'
    );
  }
  if (gate.message) notes.push(gate.message);

  return {
    generatedAt: (input.now ?? new Date()).toISOString(),
    platform,
    config,
    evalForced,
    gate,
    effective,
    helper,
    coverage: { ...SANDBOX_COVERAGE },
    affectedTools: [...AFFECTED_TOOLS],
    notes,
  };
}

/** Linux 能力原因 → 机读码（未知自由文本归 `probe-failed`） */
function linuxReasonCode(capability: SandboxCapabilityView): string {
  if (capability.available) return 'ok';
  const reason = capability.reason ?? '';
  return LINUX_REASON_CODES.has(reason) ? reason : 'probe-failed';
}

/** 组装 helper 事实（present/runnable/reasonCode 三者**分别**判定，不互相推断） */
function buildHelperView(input: {
  platform: NodeJS.Platform;
  required: boolean;
  linuxPath: string | null;
  linuxCapability: SandboxCapabilityView | null;
  macCapability: SandboxCapabilityView | null;
  winCapability: SandboxCapabilityView | null;
  helperExists(path: string): boolean;
}): SandboxProbeView['helper'] {
  const { platform, required } = input;
  if (platform === 'linux') {
    const path = input.linuxPath ?? '';
    const cap = input.linuxCapability;
    return {
      kind: 'landlock-run',
      required,
      present: path ? input.helperExists(path) : false,
      runnable: cap ? cap.available : null,
      reasonCode: cap ? linuxReasonCode(cap) : 'not-checked',
      ...(cap?.reason ? { detail: cap.reason } : {}),
      ...(path ? { path } : {}),
    };
  }
  if (platform === 'darwin') {
    const cap = input.macCapability;
    return {
      kind: 'sandbox-exec',
      required,
      present: cap ? cap.available : null,
      runnable: cap ? cap.available : null,
      reasonCode: cap ? (cap.available ? 'ok' : 'not-found') : 'not-checked',
      ...(cap?.reason ? { detail: cap.reason } : {}),
      ...(cap?.path ? { path: cap.path } : {}),
    };
  }
  if (platform === 'win32') {
    const cap = input.winCapability;
    // 2026-11-19：helper 补齐 `--probe` 后改为**实测**（不再固定 runnable=null）。
    // present / runnable 分别取值，互不推断（"文件存在"仍然 ≠ "可执行"）。
    const present = cap ? (cap.present ?? cap.available) : null;
    const runnable = cap ? (cap.runnable ?? null) : null;
    const reasonCode = cap
      ? runnable === true
        ? 'ok'
        : runnable === false
          ? cap.reasonCode && WIN_REASON_CODES.has(cap.reasonCode)
            ? cap.reasonCode
            : present
              ? 'probe-failed'
              : 'not-found'
          : present
            ? 'probe-unsupported'
            : 'not-found'
      : 'not-checked';
    return {
      kind: 'win-sandbox-run',
      required,
      present,
      runnable,
      reasonCode,
      ...(cap?.reason ? { detail: cap.reason } : {}),
      ...(cap?.path ? { path: cap.path } : {}),
    };
  }
  return {
    kind: 'none',
    required,
    present: null,
    runnable: null,
    reasonCode: 'platform-unsupported',
  };
}

/** 默认依赖：动态导入真实实现（保持 infrastructure 无静态跨层依赖） */
async function loadDefaultDeps(): Promise<SandboxProbeDeps> {
  const sandbox = await import('@modules/sandbox');
  const bash = await import('@modules/tools/bash/bashLandlockExec');
  return {
    platform: process.platform,
    readConfig: () => sandbox.readLandlockConfig(),
    isEvalForced: () => sandbox.isEvalBashLandlockForced(),
    detectLinux: () => sandbox.LandlockDetector.detect(),
    detectMac: () => sandbox.detectMacOSSandboxCapability(),
    detectWindows: () => sandbox.detectWindowsSandboxCapability(),
    linuxHelperPath: () => sandbox.resolveLandlockHelperPath(),
    helperExists: (path) => existsSync(path),
    clearDetectorCaches: () => {
      sandbox.LandlockDetector.clearCache();
      sandbox.clearMacOSSandboxCapabilityCache();
      sandbox.clearWindowsSandboxCapabilityCache();
    },
    decideGate: (input) =>
      bash.decideBashLandlockGate(
        input as Parameters<typeof bash.decideBashLandlockGate>[0]
      ) as SandboxGateView,
  };
}

/**
 * 执行一次只读探针。
 *
 * @param options.force `true` ⇒ 先清探测器缓存再探测（"手动重测"；默认用缓存结果）。
 *   保存危险开关后 UI 应带 `?refresh=1` 调一次，否则 Windows 的模块级缓存会回显旧结论。
 * @param options.deps 测试注入（覆盖平台/配置/能力探测/门控）
 */
export async function probeCommandSandbox(
  options: { force?: boolean; deps?: Partial<SandboxProbeDeps> } = {}
): Promise<SandboxProbeView> {
  const deps: SandboxProbeDeps = {
    ...(await loadDefaultDeps()),
    ...options.deps,
  };
  if (options.force) deps.clearDetectorCaches();

  const config = deps.readConfig();
  const evalForced = deps.isEvalForced();
  // 总开关关闭 ⇒ 不探测（探测有成本/副作用）；开关开着即使 bashEnabled=false 也探测，
  // 供 UI 显示"本机沙箱可用不可用"（灰条），但不改变判定。
  const probeCapabilities = config.enabled;
  const linuxCapability =
    probeCapabilities && deps.platform === 'linux'
      ? await deps.detectLinux()
      : null;
  const macCapability =
    probeCapabilities && deps.platform === 'darwin' ? deps.detectMac() : null;
  const winCapability =
    probeCapabilities && deps.platform === 'win32'
      ? deps.detectWindows()
      : null;

  const gate = deps.decideGate({
    config,
    platform: deps.platform,
    capability: linuxCapability,
    macCapability,
    evalForced,
  });

  const helper = buildHelperView({
    platform: deps.platform,
    required: config.enabled && config.bashEnabled,
    linuxPath: deps.platform === 'linux' ? deps.linuxHelperPath() : null,
    linuxCapability,
    macCapability,
    winCapability,
    helperExists: deps.helperExists,
  });

  return composeSandboxProbe({
    platform: deps.platform,
    config,
    evalForced,
    gate,
    helper,
  });
}

/**
 * 沙箱探针 GET /v1/diagnostics/sandbox/probe（只读；`?refresh=1` 强制重测）
 *
 * 放在**诊断面**而非写面（评审 P1-1）：与 `PUT /v1/config/sandbox` 分离，避免"读探针"
 * 与"改开关"混在同一前缀下。
 */
export async function handleGetSandboxProbe(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const force = /[?&]refresh=1\b/.test(req.url ?? '');
    const probe = await probeCommandSandbox({ force });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(probe));
  } catch (err) {
    sendError(res, err);
  }
}
