/**
 * 围栏进程入口（G4 / M1，2026-11-12）
 *
 * **只读观察者**：读 `<securityDir>/security-audit.log`（增量）与
 * `<securityDir>/sandbox-posture.json`（主进程 M0-③ 落盘），写自己的
 * `<securityDir>/fence-heartbeat.json` 与 `<securityDir>/fence-alerts.jsonl`。
 *
 * 边界（见 `dev_docs/20261112/G4-围栏工程形态设计-20261112.md`）：
 * - 不 import 被观察子系统（permission / security / sandbox）的运行时代码；
 * - 不做 allow/ask/deny 判定，不写主进程状态；
 * - 生命周期告警只在状态跃迁时发一次；`no-signal` 与"一切正常"分开。
 *
 * 启动（开发期）：`bun app/src/entrypoints/fence.ts`
 * （发布打包入口不在本步；届时需登记 build 产物与安装方式）
 */
import { join } from 'node:path';

import { getRuntimeDefaults } from '@openliri/infra/constants/defaults';
import { resolveSecurityDir } from '@openliri/infra/environment';
import { getLogger } from '@openliri/infra/monitoring';

import { startFence, type FencePaths } from './fence/runtime.js';

const logger = getLogger('security:fence');

/** 围栏读取/写入的四个路径（默认都落在 securityDir 下） */
export function resolveFencePaths(
  securityDir: string = resolveSecurityDir()
): FencePaths {
  return {
    auditLogPath: join(securityDir, 'security-audit.log'),
    posturePath: join(securityDir, 'sandbox-posture.json'),
    heartbeatPath: join(securityDir, 'fence-heartbeat.json'),
    alertsPath: join(securityDir, 'fence-alerts.jsonl'),
  };
}

/**
 * 启动围栏循环（进程级入口；信号到达前一直运行）。
 *
 * `intervalMs` / `postureStaleAfterMs` 取 B 类运行参数（可用 `LIRI_SANDBOX_FENCE_*` 覆盖）。
 */
export async function runFence(): Promise<void> {
  const defaults = getRuntimeDefaults();
  const paths = resolveFencePaths();
  const handle = startFence({
    paths,
    intervalMs: defaults.sandboxFenceIntervalMs,
    postureStaleAfterMs: defaults.sandboxFencePostureStaleMs,
    startAtEof: defaults.sandboxFenceStartAtEof,
    rules: {
      silentAllowRunLength: defaults.sandboxFenceSilentAllowRunLength,
      silentAllowDedupWindowMs: defaults.sandboxFenceSilentAllowDedupMs,
      denyRetryWindowMs: defaults.sandboxFenceDenyRetryWindowMs,
    },
  });
  logger.info('围栏已启动（只读观察者，不参与判定）', {
    auditLogPath: paths.auditLogPath,
    posturePath: paths.posturePath,
    heartbeatPath: paths.heartbeatPath,
    intervalMs: defaults.sandboxFenceIntervalMs,
    startAtEof: defaults.sandboxFenceStartAtEof,
  });

  const shutdown = (signal: string): void => {
    handle.stop();
    logger.info('围栏已停止', { signal });
    process.exit(0);
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

if (import.meta.main) {
  void runFence();
}
