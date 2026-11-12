/**
 * 沙箱姿态快照落盘（G4 围栏 M0-③，2026-11-12）
 *
 * 背景：围栏是**另一个进程**的只读观察者（设计见 `dev_docs/20261112/G4-围栏工程形态设计-20261112.md`）。
 * 它不能调 `ISandboxPort.getRuntimeStatus()`（跨进程无意义，且等于让被观察者自证），
 * 故由主进程把「当前姿态 + 违规摘要」**定期原子落盘**到 `<securityDir>/sandbox-posture.json`。
 *
 * 边界：
 * - 只**写**快照，不改任何 allow / ask / deny 判定，也不改沙箱默认值；
 * - 写入失败不阻断启动（围栏侧按 missing / stale 处理），但**不静默**：同一错误只告警一次；
 * - 定时器 `unref()` ⇒ 不阻止进程退出。
 */
import { join } from 'node:path';

import { resolveSecurityDir } from '@openliri/infra/environment';
import { getRuntimeDefaults } from '@openliri/infra/constants/defaults';
import { getLogger } from '@openliri/infra/monitoring';
import { writeFileAtomic } from '@openliri/infra/utils/atomicFileWrite';
import type { SandboxViolationEvent } from '@modules/sandbox';
import type { SandboxPosture } from '@modules/sandbox/sandboxPosture';

const logger = getLogger('sandbox:postureSnapshot');

/** 围栏读取的文件名（与设计文档 I2 一致） */
export const SANDBOX_POSTURE_SNAPSHOT_FILE = 'sandbox-posture.json';

/** 结构版本：字段变更时递增，围栏据此拒绝解析未知结构（不猜） */
export const SANDBOX_POSTURE_SNAPSHOT_SCHEMA_VERSION = 1;

/** 落盘内容（只读字段，供围栏消费；语义与 `SandboxRuntimeStatus.posture` 同源） */
export interface SandboxPostureSnapshot {
  schemaVersion: number;
  /** 采集时刻（ISO 8601）；围栏据此判断快照是否过期 */
  capturedAt: string;
  /** 隔离模式（`none` = 无隔离证据） */
  mode: string;
  permissionLevel: string;
  bashSandboxReason: string;
  landlock: {
    enabled: boolean;
    bashEnabled: boolean;
    failClosed: boolean;
    available: boolean;
  };
  /** fail-open 风险的语言中立编码（围栏规则 S4 消费） */
  openRiskCodes: string[];
  /** 同上的人类可读说明（仅供取证展示） */
  openRisks: string[];
  /** 沙箱违规累计数（内存保留上限见 `MAX_RECORDED_SANDBOX_VIOLATIONS`） */
  violationCount: number;
  /** 最近若干条违规（按时间升序；供围栏取证，不落完整历史） */
  recentViolations: Array<{
    /** 语言中立类型编码（`write-denied` / `init-failed`） */
    type: string;
    message: string;
    timestamp: string;
  }>;
}

/** 采集源：由调用方每次现取（姿态可随配置变化，不缓存启动时的快照） */
export interface SandboxPostureSnapshotSource {
  posture: SandboxPosture;
  /** 当前内存中的违规记录（数量与最近条目均从此派生，避免计数与列表不一致） */
  violations: ReadonlyArray<SandboxViolationEvent>;
}

/**
 * 快照里保留的最近违规条数（只取尾部 N 条；完整历史不落盘）。
 *
 * 为什么是 20：围栏只做"最近是否发生越界"的判别与取证展示，
 * 全量序列化会让 30s 一次的落盘随历史线性增长。
 */
export const SANDBOX_POSTURE_SNAPSHOT_RECENT_VIOLATIONS = 20;

/**
 * 构造快照（**纯函数**，不做 IO）。
 * @param source 当前姿态与违规记录
 * @param now 采集时刻（单测注入，默认当前时间）
 */
export function buildSandboxPostureSnapshot(
  source: SandboxPostureSnapshotSource,
  now: Date = new Date()
): SandboxPostureSnapshot {
  const { posture, violations } = source;
  return {
    schemaVersion: SANDBOX_POSTURE_SNAPSHOT_SCHEMA_VERSION,
    capturedAt: now.toISOString(),
    mode: posture.mode,
    permissionLevel: posture.permissionLevel,
    bashSandboxReason: posture.bashSandboxReason,
    landlock: {
      enabled: posture.landlock.enabled,
      bashEnabled: posture.landlock.bashEnabled,
      failClosed: posture.landlock.failClosed,
      available: posture.landlock.available,
    },
    openRiskCodes: [...posture.openRiskCodes],
    openRisks: [...posture.openRisks],
    violationCount: violations.length,
    recentViolations: violations
      .slice(-SANDBOX_POSTURE_SNAPSHOT_RECENT_VIOLATIONS)
      .map((violation) => ({
        type: violation.type,
        message: violation.message,
        timestamp: violation.timestamp.toISOString(),
      })),
  };
}

export interface SandboxPostureSnapshotWriterOptions {
  /** 每次落盘时现取（不缓存启动态） */
  read: () => SandboxPostureSnapshotSource;
  /** 刷新间隔（缺省取 B 类运行参数 `sandboxPostureSnapshotIntervalMs`；单测可注入极小值） */
  intervalMs?: number;
  /** 目标文件（默认 `<securityDir>/sandbox-posture.json`；单测注入临时目录） */
  targetPath?: string;
  /** 写入实现（默认 infra 原子写；单测用于注入失败/观测） */
  writeFile?: (targetPath: string, data: string) => Promise<void>;
}

export interface SandboxPostureSnapshotWriterHandle {
  /** 目标文件绝对路径 */
  targetPath: string;
  /** 立即写一次（并发调用安全；失败已内部降级，不会 reject） */
  flush: () => Promise<void>;
  /** 停止定时器（不影响进程退出：定时器本身已 unref） */
  stop: () => void;
}

/**
 * 启动周期落盘：**立刻写一次**（围栏不必等到第一个周期），随后按 `intervalMs` 刷新。
 *
 * 失败语义：写入失败只告警（同一错误只告警一次，恢复时补一条 info），
 * 绝不上抛 —— 快照缺失只影响围栏取证，不影响权限/沙箱判定。
 */
export function startSandboxPostureSnapshotWriter(
  options: SandboxPostureSnapshotWriterOptions
): SandboxPostureSnapshotWriterHandle {
  const targetPath =
    options.targetPath ??
    join(resolveSecurityDir(), SANDBOX_POSTURE_SNAPSHOT_FILE);
  const writeFile = options.writeFile ?? writeFileAtomic;
  const intervalMs =
    options.intervalMs ?? getRuntimeDefaults().sandboxPostureSnapshotIntervalMs;

  let lastError: string | null = null;
  /** 串行化写入：避免「启动立即写」与定时写重叠（重叠时原子写虽安全，但测试/取证看到中间态） */
  let queue: Promise<void> = Promise.resolve();

  const runFlush = async (): Promise<void> => {
    try {
      const snapshot = buildSandboxPostureSnapshot(options.read());
      await writeFile(targetPath, `${JSON.stringify(snapshot, null, 2)}\n`);
      if (lastError !== null) {
        logger.info('沙箱姿态快照恢复写入', { targetPath });
        lastError = null;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== lastError) {
        logger.warn('沙箱姿态快照写入失败（围栏将读到缺失/陈旧数据）', {
          targetPath,
          error: message,
        });
        lastError = message;
      }
    }
  };

  const flush = (): Promise<void> => {
    queue = queue.then(runFlush);
    return queue;
  };

  // 立即写一次：不 await（启动路径不被磁盘 IO 阻塞），失败由 runFlush 内部降级
  void flush();
  const timer = setInterval(() => {
    void flush();
  }, intervalMs);
  // 不阻止进程退出：快照属观察面，不是必须完成的工作
  if (typeof timer.unref === 'function') timer.unref();

  return {
    targetPath,
    flush,
    stop: () => clearInterval(timer),
  };
}
