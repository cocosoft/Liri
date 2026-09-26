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
 * G1-C（2026-09-26，《Liri 优化方案》G 组）：**bash 无内核级约束**的顾问性提示。
 *
 * **背景（实测，见 [`governance-g-group.md`](../../../../.trae/specs/governance-g-group.md) §1.3）**：
 * `code_run` 路径已接入 Landlock（`LinuxSandboxRunner` 经 `LandlockDetector` + `buildLandlockArgv`），
 * 而**活跃的 `bash` 路径完全没有内核级强制** —— 只有 `SandboxSecurityChecker.checkDangerousCommands()`
 * 的**事前静态检查**，执行方式是 `child_process.exec`。属**实际安全缺口**，但**不属"名义契约谎报"**
 * （bash 从未声称自己有 Landlock）。
 *
 * **本轮采用方案给的"选项 C：能力探测 + 告警"**（用户 2026-09-26 裁定），**不改执行路径**：
 * - 只在"**Linux 且 Landlock 似乎可用**"时提示 —— 能力都不具备时无可接入之物，提示没有信息量；
 * - 提示是**顾问性**的：不拦截、不改造、不降级任何执行行为；
 * - **全进程只提示一次**（模块级标记），避免每条命令刷屏。
 *
 * ⚠️ **两条如实说明（都影响结论强度）**：
 *
 * 1. **信号强度有限**：本模块**只读** `/sys/kernel/security/lsm`（列表中是否含 `landlock`），
 *    **不做**功能 probe。原因不是偷懒：`LandlockDetector.detect()` 的结果是**全局缓存**，而真实路径
 *    （`LinuxSandboxRunner`）用**它自己的 `helperPath`** 去探测；此处若用默认 helper 探测并写入缓存，
 *    会把缓存变成另一套结论，进而**污染 `code_run` 的安全判定**（真实回归风险）。故刻意**不复用**该探测器，
 *    代价是 LSM 列表本身有盲区 ⇒ 本提示**只作线索**，**不得**当作"Landlock 已生效/未生效"的判据。
 * 2. **不改行为**：本模块不参与任何控制流，且**吞掉自身的全部失败**（见 `reportBashLandlockGapOnce`
 *    的 `@ignore-catch`）—— 顾问性提示绝不能反过来让 bash 执行失败。
 */

import { readFile } from 'node:fs/promises';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('tools:bash:landlock');

/** 内核 LSM 列表路径（内容含 `landlock` 表示该 LSM 已启用） */
const LSM_PATH = '/sys/kernel/security/lsm';

/** 全进程只提示一次 */
let reported = false;

export interface BashLandlockGapVerdict {
  /** 是否应当提示 */
  report: boolean;
  /** 判定原因（枚举，便于用例逐分支断言） */
  reason:
    | 'not-linux'
    | 'already-reported'
    | 'landlock-not-enabled'
    | 'landlock-available-but-unused'
    /** 探测或告警出口自身异常（**不**等同于"未启用"，如实区分） */
    | 'probe-failed';
}

export interface BashLandlockGapDeps {
  platform?: NodeJS.Platform;
  /** 读 LSM 列表；不可读 ⇒ `null` */
  readLsm?: () => Promise<string | null>;
  /** 告警出口（默认 `logger.warn`；测试注入以取得"确已告警"的证据） */
  warn?: (message: string, meta?: Record<string, unknown>) => void;
}

/** 纯判据（零 IO、零状态）—— 便于离线覆盖全部分支 */
export function judgeBashLandlockGap(input: {
  platform: NodeJS.Platform;
  lsm: string | null;
  alreadyReported: boolean;
}): BashLandlockGapVerdict {
  if (input.platform !== 'linux') {
    return { report: false, reason: 'not-linux' };
  }
  if (input.alreadyReported) {
    return { report: false, reason: 'already-reported' };
  }
  const hasLandlock =
    !!input.lsm &&
    input.lsm.split(',').some((part) => part.trim().includes('landlock'));
  if (!hasLandlock) {
    return { report: false, reason: 'landlock-not-enabled' };
  }
  return { report: true, reason: 'landlock-available-but-unused' };
}

/** 默认读 LSM 列表；文件不存在 / 权限不足（含非 Linux）⇒ `null` */
async function readLsmDefault(): Promise<string | null> {
  try {
    return await readFile(LSM_PATH, 'utf8');
  } catch {
    // @ignore-catch 读不到 LSM 列表＝"无法判断能力"，按"未启用"处理（不臆断为可用）
    return null;
  }
}

/**
 * 探测 + 提示（**全进程一次**）。返回判定结论供调用方/用例观察。
 *
 * **不抛错、不影响执行路径**：整个函数体对自身失败兜底（§1.9 `@ignore-catch`）。
 */
export async function reportBashLandlockGapOnce(
  deps: BashLandlockGapDeps = {}
): Promise<BashLandlockGapVerdict> {
  // 已提示过 ⇒ 短路（此后零 IO、零副作用）
  if (reported) return { report: false, reason: 'already-reported' };

  const platform = deps.platform ?? process.platform;
  if (platform !== 'linux') return { report: false, reason: 'not-linux' };

  try {
    const lsm = await (deps.readLsm ?? readLsmDefault)();
    const verdict = judgeBashLandlockGap({
      platform,
      lsm,
      alreadyReported: false,
    });
    if (!verdict.report) return verdict;

    // 先落标记再告警：告警出口若异常，也不该退化成"每条命令重试"
    reported = true;
    const warn = deps.warn ?? ((message, meta) => logger.warn(message, meta));
    warn(
      'bash 无内核级约束：本机 Landlock 可用，但 bash 执行路径未接入（仅事前黑名单检查）—— 已知安全缺口（G1-C），本轮只提示不改行为',
      {
        platform,
        lsmPath: LSM_PATH,
        options: '接入=选项 A（需 Linux 验证）/ 记录=选项 B',
      }
    );
    return verdict;
  } catch {
    // @ignore-catch 顾问性提示：任何失败都不得影响 bash 执行（也不得再抛给调用方）。
    // 返回 `probe-failed` 而**不**复用 `landlock-not-enabled` —— "探测失败"与"确知未启用"是两件事。
    return { report: false, reason: 'probe-failed' };
  }
}

/** 测试用：重置"已提示"标记（对齐 `LandlockDetector.clearCache()` 的做法） */
export function resetBashLandlockGapReported(): void {
  reported = false;
}
