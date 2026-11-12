/**
 * 围栏运行时（G4 / M1，只读观察者）。
 *
 * 每个 tick 做三件事：**增量读审计日志** → **读姿态快照并判新鲜度** → **写心跳/告警**。
 * 不参与任何 allow/ask/deny 判定，不写主进程状态，异常只影响自己的告警面。
 *
 * 生命周期告警按**状态跃迁**去重（进入坏状态时告警一次，恢复后才能再次告警），
 * 避免 10s 一次的心跳把同一个缺失刷成告警洪流。
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { getLogger } from '@openliri/infra/monitoring';
import { writeFileAtomic } from '@openliri/infra/utils/atomicFileWrite';

import { readAppendedJsonlLines, type JsonlTailDeps } from './jsonlTail';
import { observeFencePosture } from './posture';
import {
  FENCE_FAIL_OPEN_CODES,
  createFenceRuleState,
  evaluateAuditEvent,
  parseAuditEvent,
  type FenceRuleConfig,
  type FenceRuleState,
} from './rules';
import type {
  FenceAlert,
  FenceAlertKind,
  FenceHeartbeat,
  FencePostureObservation,
} from './types';

const logger = getLogger('security:fence');

/** 围栏自己写入的心跳/告警结构版本 */
const FENCE_HEARTBEAT_SCHEMA_VERSION = 1;

export interface FencePaths {
  /** 主进程写入的 `security-audit.log` */
  auditLogPath: string;
  /** 主进程写入的 `sandbox-posture.json` */
  posturePath: string;
  /** 围栏自己的心跳 */
  heartbeatPath: string;
  /** 围栏自己的告警（JSONL，append-only） */
  alertsPath: string;
}

export interface FenceRuntimeDeps extends JsonlTailDeps {
  paths: FencePaths;
  /** 姿态快照超过该时长未更新 ⇒ `stale` */
  postureStaleAfterMs: number;
  /** M2 规则阈值（S1 连续次数 / S2 重试窗口） */
  rules: FenceRuleConfig;
  /** 注入时钟（单测用；默认 `new Date()`） */
  now?: () => Date;
  /** 读文本文件（默认 `fs.readFile(..., 'utf8')`） */
  readTextFile?: (path: string) => Promise<string>;
  /** 原子写（默认 infra `writeFileAtomic`） */
  writeFileAtomic?: (path: string, data: string) => Promise<void>;
  /** 追加写（默认 `fs.appendFile`，自动建目录） */
  appendFile?: (path: string, data: string) => Promise<void>;
}

export interface FenceTickResult {
  heartbeat: FenceHeartbeat;
  /** 本次 tick 新产生的告警（已同时追加到 `alertsPath`） */
  alerts: FenceAlert[];
}

export interface FenceHandle {
  tick: () => Promise<FenceTickResult>;
  stop: () => void;
}

/** 一次 tick 的内部状态（跨 tick 保留：偏移、已消费摘要、最后事件时间、告警跃迁、规则状态） */
interface FenceState {
  offset: number;
  /** 已消费前缀的摘要（识别"同长度轮转/替换"） */
  consumedHash?: string;
  lastEventAt?: string;
  /** kind → 当前是否处于坏状态（跃迁去重） */
  bad: Map<FenceAlertKind, boolean>;
  /** M2：S1/S2 的跨事件状态 */
  rules: FenceRuleState;
  /** M2：上一次的 fail-open 编码签名（S4 仅在变化时告警） */
  failOpenSignature: string;
}

function createState(): FenceState {
  return {
    offset: 0,
    bad: new Map(),
    rules: createFenceRuleState(),
    failOpenSignature: '',
  };
}

/**
 * 创建一个可手动 `tick()` 的围栏实例（不启动定时器；单测直接驱动）。
 */
export function createFence(deps: FenceRuntimeDeps): {
  tick: () => Promise<FenceTickResult>;
} {
  const state: FenceState = createState();
  return { tick: () => runTick(state, deps) };
}

/**
 * 启动围栏循环：**立即 tick 一次**，随后按 `intervalMs` 采样。
 *
 * @param unref 默认 `false` —— 作为独立进程时**必须**保持事件循环（否则启动即退出）；
 *   仅在"随主进程一起跑"的测试/嵌入场景显式传 `true`。
 */
export function startFence(
  deps: FenceRuntimeDeps & { intervalMs: number; unref?: boolean }
): FenceHandle {
  const state: FenceState = createState();
  const tick = async (): Promise<FenceTickResult> => {
    try {
      return await runTick(state, deps);
    } catch (error) {
      // 观测面异常不得让围栏进程崩掉（否则"观察者消失"本身无人发现）
      logger.warn('围栏 tick 失败（保持循环，下一轮重试）', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };

  void tick().catch(() => {
    // 首轮失败已在上方记录；循环继续
  });
  const timer = setInterval(() => {
    void tick().catch(() => {
      // 已记录
    });
  }, deps.intervalMs);
  if (deps.unref === true && typeof timer.unref === 'function') timer.unref();

  return {
    tick,
    stop: () => clearInterval(timer),
  };
}

async function runTick(
  state: FenceState,
  deps: FenceRuntimeDeps
): Promise<FenceTickResult> {
  const now = deps.now?.() ?? new Date();
  const at = now.toISOString();
  const alerts: FenceAlert[] = [];

  // ① 审计日志：增量读（截断/轮转 ⇒ 归零并告警）
  const previousOffset = state.offset;
  const tail = await readAppendedJsonlLines(
    deps.paths.auditLogPath,
    state.offset,
    deps,
    state.consumedHash
  );
  state.offset = tail.nextOffset;
  state.consumedHash = tail.consumedHash;
  if (tail.truncated) {
    alerts.push({
      at,
      kind: 'log-rotated',
      detail: `offset ${previousOffset} → 0（审计日志被截断或轮转）`,
    });
  }
  pushTransition(
    state,
    alerts,
    at,
    'audit-log-missing',
    !tail.exists,
    `审计日志不存在: ${deps.paths.auditLogPath}`
  );

  let invalidLines = 0;
  for (const line of tail.lines) {
    const event = parseAuditEvent(line);
    if (event === undefined) {
      invalidLines++;
      continue;
    }
    state.lastEventAt = event.timestamp;
    // M2：S1 / S2（事件驱动；S4 依赖姿态快照，见下方 ②）
    for (const finding of evaluateAuditEvent(event, state.rules, deps.rules)) {
      alerts.push({ at, kind: finding.kind, detail: finding.detail });
    }
  }
  if (invalidLines > 0) {
    alerts.push({
      at,
      kind: 'audit-line-invalid',
      detail: `本 tick 有 ${invalidLines} 行不可解析（已跳过，不猜内容）`,
    });
  }

  // ② 姿态快照：四态（ok / stale / missing / invalid）
  const posture = await readPosture(deps, now);
  pushTransition(
    state,
    alerts,
    at,
    'posture-missing',
    posture.state === 'missing',
    `姿态快照不存在: ${deps.paths.posturePath}`
  );
  pushTransition(
    state,
    alerts,
    at,
    'posture-invalid',
    posture.state === 'invalid',
    posture.reason ?? '姿态快照不可解析'
  );
  pushTransition(
    state,
    alerts,
    at,
    'posture-stale',
    posture.state === 'stale',
    `姿态快照已过期 ${posture.ageMs ?? 0}ms（阈值 ${deps.postureStaleAfterMs}ms）`
  );

  // M2 / S4：fail-open 姿态（只在编码集合**变化**时告警，避免 10s 一次刷屏）
  const failOpenCodes = (posture.openRiskCodes ?? [])
    .filter((code) => FENCE_FAIL_OPEN_CODES.includes(code))
    .sort();
  const failOpenSignature = failOpenCodes.join(',');
  if (failOpenSignature !== state.failOpenSignature) {
    state.failOpenSignature = failOpenSignature;
    if (failOpenSignature) {
      alerts.push({
        at,
        kind: 'sandbox-fail-open',
        detail: `姿态存在 fail-open 编码: ${failOpenSignature}`,
      });
    }
  }

  // ③ 心跳 + 告警落盘
  const heartbeat: FenceHeartbeat = {
    schemaVersion: FENCE_HEARTBEAT_SCHEMA_VERSION,
    at,
    // "无信号"与"一切正常"必须可区分：两者都缺 ⇒ 观察者其实是瞎的
    status:
      tail.exists || posture.state !== 'missing' ? 'observing' : 'no-signal',
    audit: {
      exists: tail.exists,
      appendedEvents: tail.lines.length,
      offset: state.offset,
      ...(state.lastEventAt ? { lastEventAt: state.lastEventAt } : {}),
    },
    posture,
  };

  const writeAtomic = deps.writeFileAtomic ?? writeFileAtomic;
  await writeAtomic(
    deps.paths.heartbeatPath,
    `${JSON.stringify(heartbeat, null, 2)}\n`
  );

  if (alerts.length > 0) {
    const append = deps.appendFile ?? defaultAppend;
    const payload = alerts
      .map((alert) => `${JSON.stringify(alert)}\n`)
      .join('');
    await append(deps.paths.alertsPath, payload);
  }

  return { heartbeat, alerts };
}

async function readPosture(
  deps: FenceRuntimeDeps,
  now: Date
): Promise<FencePostureObservation> {
  const readText =
    deps.readTextFile ?? ((path: string) => readFile(path, 'utf8'));
  let raw: string;
  try {
    raw = await readText(deps.paths.posturePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { state: 'missing' };
    }
    throw error;
  }
  return observeFencePosture({
    exists: true,
    raw,
    now,
    staleAfterMs: deps.postureStaleAfterMs,
  });
}

/** 只在"进入坏状态"时告警一次；恢复后清位，允许下次再告警 */
function pushTransition(
  state: FenceState,
  alerts: FenceAlert[],
  at: string,
  kind: FenceAlertKind,
  isBad: boolean,
  detail: string
): void {
  const wasBad = state.bad.get(kind) === true;
  if (isBad && !wasBad) {
    alerts.push({ at, kind, detail });
  }
  state.bad.set(kind, isBad);
}

async function defaultAppend(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, data, 'utf8');
}
