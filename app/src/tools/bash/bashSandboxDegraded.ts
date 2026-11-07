// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * bash「未隔离」的可观测信号（P2，2026-11-07）。
 *
 * 决策背景（用户 2026-11-07 拍板：「保持不沙箱 + 补齐可观测」）：
 * `win-sandbox-run.exe` 只做 **Low IL + Job Object**，**不做路径授权**；
 * Low IL 进程默认写不了 Medium 目录（用户仓库就是 Medium）⇒ 让 bash 真写隔离
 * 必须给用户仓库加 Low IL 的 ACL（grant/setintegritylevel），存在残留/并发污染，
 * 见 `.trae/specs/windows-sandbox.md §3.3`（v1 明确不做）。
 *
 * 因此 Windows 上 bash **继续 plain 执行**，但必须让这件事**可查**：
 * 每条 `bash: exec_ok` 已带 `mode: 'plain'`；本模块补**一次**结构化告警，
 * 说明「不是开关没开，而是平台不支持」，避免被误读成"沙箱已保护开发命令"。
 *
 * 只做描述 / 打日志：**不参与任何 allow / ask / deny 判定**，也不改执行路径。
 */

import { getLogger } from '@openliri/infra/monitoring';

const logger = getLogger('tools:bash:sandbox');

/** 全进程只提示一次（模块级标记，避免每条命令刷屏） */
let reported = false;

export interface BashSandboxDegradedVerdict {
  report: boolean;
  reason: 'windows-unsupported' | 'not-windows' | 'already-reported';
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
  return { report: true, reason: 'windows-unsupported' };
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
    warn('bash: sandbox_degraded —— 本平台无法对 bash 做 OS 级隔离', {
      mode: 'plain',
      reason: 'platform-unsupported',
      writablePolicy: 'unrestricted',
      // 让读者一眼看到"为什么不是开个开关就行"
      why: 'Windows Low IL 沙箱要求给工作区改 ACL（残留/并发污染），v1 明确不做',
      ref: '.trae/specs/windows-sandbox.md §3.3',
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
