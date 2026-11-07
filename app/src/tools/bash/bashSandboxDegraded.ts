// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * bash「未隔离」的可观测信号（P2，2026-11-07；2026-11-07 晚随方案 §10 更新口径）。
 *
 * 2026-11-07 白天：Windows 上 bash 只能 plain 执行（Low IL 需要给工作区改 ACL，当时判定不做）。
 * 2026-11-07 晚（方案 §10）：用户拍板「临时授权 + finally 撤销」，Windows 已能真写隔离
 * ⇒ 是否隔离变成**显式开关**（`sandbox.landlock.bashEnabled`，默认关）。
 *
 * 因此本模块的职责收窄为：**开关没开时如实说明"现在没隔离"**（不是平台做不到），
 * 避免被误读成"沙箱已保护开发命令"。
 *
 * 只做描述 / 打日志：**不参与任何 allow / ask / deny 判定**，也不改执行路径。
 */

import { getLogger } from '@openliri/infra/monitoring';

const logger = getLogger('tools:bash:sandbox');

/** 全进程只提示一次（模块级标记，避免每条命令刷屏） */
let reported = false;

export interface BashSandboxDegradedVerdict {
  report: boolean;
  reason: 'windows-bash-opt-in' | 'not-windows' | 'already-reported';
}

/** 纯判据（零 IO、零状态）—— 便于离线覆盖分支 */
export function judgeBashSandboxDegraded(input: {
  platform: NodeJS.Platform;
  alreadyReported: boolean;
}): BashSandboxDegradedVerdict {
  if (input.platform !== 'win32') {
    return { report: false, reason: 'not-windows' };
  }
  if (input.alreadyReported) {
    return { report: false, reason: 'already-reported' };
  }
  return { report: true, reason: 'windows-bash-opt-in' };
}

export interface BashSandboxDegradedDeps {
  platform?: NodeJS.Platform;
  /** 告警出口（默认 `logger.warn`；测试注入以取得"确已告警"的证据） */
  warn?: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * Windows 上 bash 未隔离的**一次性**告警。
 *
 * 不抛错、不影响执行：调用方在 plain 分支调用它，任何异常都必须被吞掉。
 */
export function reportBashSandboxDegradedOnce(
  deps: BashSandboxDegradedDeps = {}
): BashSandboxDegradedVerdict {
  const verdict = judgeBashSandboxDegraded({
    platform: deps.platform ?? process.platform,
    alreadyReported: reported,
  });
  if (!verdict.report) return verdict;

  // 先落标记再告警：告警出口若异常，也不该退化成"每条命令重试"
  reported = true;
  try {
    const warn = deps.warn ?? ((message, meta) => logger.warn(message, meta));
    warn('bash: sandbox_degraded —— 本平台当前未对 bash 做 OS 级隔离', {
      mode: 'plain',
      reason: 'windows-bash-opt-in',
      writablePolicy: 'unrestricted',
      // 让读者一眼看到"怎么开、开了会发生什么"
      why: 'Windows 的 bash 写隔离需要临时把可写目录的完整性标签降为 Low（执行后恢复）⇒ 默认关闭，由 sandbox.landlock.bashEnabled 显式开启',
      ref: 'dev_docs/20261107/权限与沙箱拉通方案-20261107.md §10',
      affectedTools: ['bash', 'powershell'],
    });
  } catch {
    // @ignore-catch 顾问性告警：日志通道异常不得影响命令执行
  }
  return verdict;
}

/** 测试用：重置"已提示"标记 */
export function resetBashSandboxDegradedReported(): void {
  reported = false;
}
