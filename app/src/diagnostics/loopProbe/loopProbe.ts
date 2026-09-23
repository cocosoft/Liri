// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 事件循环阻塞探针 · P1 运行时接线（2026-09-22）
 *
 * 取证方案：[事件循环阻塞-运行时探针取证方案-20260922.md](../../../../dev_docs/事件循环阻塞-运行时探针取证方案-20260922.md)
 *
 * 触发策略 **D-P1 ①「守株待兔」**（见 `loopProbeCore` 头注）：检测到第一次阻塞后启动
 * CPU profiler，等下一次阻塞落进采样窗口再转储。**只有 `dump` 时才产生 I/O**，
 * 正常路径仅一次布尔判定 ⇒ 对用户体验零影响。
 *
 * 为什么不用 `perf_hooks.monitorEventLoopDelay`：**实测（Bun 1.3.14）该 API 未实现**
 * （阻塞 300ms 后 `max=0.0ms / mean=NaN`）⇒ 心跳继续由
 * `infrastructure-diagnostics` 的自研实现提供，本模块只消费其结果。
 *
 * 为什么不用 `bun --cpu-prof`：该参数**仅在进程退出时落盘**，对"运行中不定时阻塞"无用；
 * `node:inspector` 的 `Profiler.start/stop` 可编程按需 dump（已实测能定位到函数）。
 */

import { Session } from 'node:inspector';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { resolveDataSubDir } from '@modules/core/paths';
import { handleError } from '@modules/error';
import { getLogger } from '@modules/monitoring';
import {
  DEFAULT_PROBE_CONFIG,
  decideOnArmTimeout,
  decideOnLag,
  initProbeState,
  resolveProbeMode,
  summarizeProfile,
  type CpuProfileLike,
  type ProbeConfig,
  type ProbeState,
  type ProfileSummary,
} from './loopProbeCore';
import {
  resetPhaseStack,
  setPhaseStackEnabled,
  snapshotPhases,
  type PhaseSnapshot,
} from './phaseStack';

const logger = getLogger('diagnostics:loop-probe');

export const LOOP_PROBE_DIR_NAME = 'eventloop-blocks';

/** `Profiler.post` 的 Promise 化（inspector 原生是回调风格） */
function post(
  session: Session,
  method: string,
  params?: Record<string, unknown>
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const cb = (err: Error | null, result?: unknown): void => {
      if (err) reject(err);
      else resolve(result);
    };
    if (params) session.post(method, params, cb);
    else session.post(method, cb);
  });
}

export interface LoopProbeReport {
  lagMs: number;
  at: number;
  mem: {
    rssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
    externalMb: number;
  };
  phases: PhaseSnapshot;
  summary: ProfileSummary;
  /** 四分类的**初步**提示（最终定性需结合 P3/P4 交叉验证，不得据此单点下结论） */
  hint: string;
  artifactDir: string;
}

/**
 * 阻塞事件（**每一次**真实阻塞都产生，不依赖 profiler）—— P2 阶段级归因。
 *
 * 存在意义（2026-09-22 补）：守株待兔的 profile 只在"两次阻塞相邻（burst）"时命中；
 * 稀疏期（实测 00:00–01:09 每约 11 分钟一次）每次 arm 后 60s 内等不到下一次 ⇒
 * **永远采不到 profile**。而阶段栈是**持续记录**的：阻塞结束时 ring 里的最新条目时长
 * 即等于阻塞时长 ⇒ 可对**每一次**阻塞给出阶段级归因，零额外 CPU。
 */
/**
 * P4 交叉判据（2026-09-22 补，方案 §3-P4 的"余项"）：
 * 取 libuv 在飞**请求**与**句柄**数，作为 C 类（native / 系统调用）的旁证。
 *
 * 判读：阻塞事件发生时若 `activeRequests > 0`，说明有未完成的底层 I/O（fs / sqlite / 网络）
 * ⇒ 倾向 C 类；均为 0 则更倾向 A 类（纯 JS 同步计算）。
 *
 * 能力实测（Bun 1.3.14）：`process._getActiveRequests` / `_getActiveHandles` **均存在**；
 * 仍做防御（非函数/抛错 ⇒ -1 表示"不可用"，与"0 个"区分开，避免误判为 C 类）。
 */
function sampleProcessFacts(): {
  activeRequests: number;
  activeHandles: number;
} {
  const safeLen = (key: string): number => {
    try {
      const fn = (process as unknown as Record<string, unknown>)[key];
      if (typeof fn !== 'function') return -1;
      const v = (fn as () => unknown).call(process);
      return Array.isArray(v) ? v.length : -1;
    } catch {
      return -1;
    }
  };
  return {
    activeRequests: safeLen('_getActiveRequests'),
    activeHandles: safeLen('_getActiveHandles'),
  };
}

export interface LoopIncident {
  lagMs: number;
  at: number;
  /** 阻塞结束瞬间仍活跃的最内层阶段（若阻塞发生在阶段内部则通常为 null —— 已退出） */
  current: string | null;
  /** 自记时长与 lag 匹配的阶段（阻塞源首选判定） */
  suspects: Array<{ name: string; durationMs: number }>;
  /** 最近完成阶段（供人工判读上下文） */
  recent: Array<{ name: string; durationMs: number }>;
  memRssMb: number;
  /** libuv 在飞请求数（C 类旁证；-1 = 不可用） */
  activeRequests?: number;
  /** libuv 在飞句柄数（C 类旁证；-1 = 不可用） */
  activeHandles?: number;
}

export class LoopProbe {
  private state: ProbeState = initProbeState();
  private session: Session | null = null;
  private armTimer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;
  /** P2 阶段级归因：最近一次阻塞事件与累计次数（不依赖 profiler） */
  private lastIncident: LoopIncident | null = null;
  private incidentCount = 0;
  private readonly mode = resolveProbeMode();

  constructor(private readonly config: ProbeConfig = DEFAULT_PROBE_CONFIG) {
    // P2 阶段标签与本探针同档开关：`LOOP_PROBE=off` ⇒ 插桩点降为零开销
    setPhaseStackEnabled(this.mode !== 'off');
  }

  /** 供测试与状态巡检 */
  getState(): ProbeState {
    return { ...this.state };
  }

  getMode(): string {
    return this.mode;
  }

  /**
   * 消费一次来自心跳的真实阻塞（**已排除睡眠唤醒** —— 由调用方 `classifyEventLoopLag` 判定）。
   * 同步返回，内部异步动作不阻塞心跳自身。
   */
  onLag(lagMs: number): void {
    if (this.mode === 'off') return;

    // ① P2 阶段级归因：**每一次**阻塞都记录（不依赖 profiler，零额外 CPU）
    this.recordIncident(lagMs);

    // ② P1 守株待兔：仅在满足阈值时驱动 arm/dump 状态机
    const decision = decideOnLag(this.state, lagMs, Date.now(), this.config);
    this.state = decision.state;
    if (decision.action === 'none') return;

    if (decision.action === 'arm') {
      void this.arm().catch((err) => this.reportFailure('arm', err));
      return;
    }
    void this.dump(lagMs).catch((err) => this.reportFailure('dump', err));
  }

  /** 记录一次阻塞事件（阶段级归因），并保留最后一次供测试/巡检读取 */
  private recordIncident(lagMs: number): void {
    if (lagMs < this.config.lagThresholdMs) return;
    const phases = snapshotPhases(lagMs);
    const mem = process.memoryUsage();
    const proc = sampleProcessFacts();
    const incident: LoopIncident = {
      lagMs,
      at: Date.now(),
      current: phases.current,
      suspects: phases.suspects.map((p) => ({
        name: p.name,
        durationMs: p.durationMs,
      })),
      recent: phases.recent.slice(0, 5).map((p) => ({
        name: p.name,
        durationMs: p.durationMs,
      })),
      memRssMb: Math.round(mem.rss / 1048576),
      activeRequests: proc.activeRequests,
      activeHandles: proc.activeHandles,
    };
    this.lastIncident = incident;
    this.incidentCount++;
    logger.warn('事件循环阻塞事件（阶段级归因）', {
      lagMs: incident.lagMs,
      current: incident.current,
      suspects: incident.suspects,
      recent: incident.recent,
      memRssMb: incident.memRssMb,
      // P4 交叉判据（C 类旁证）：-1 = 不可用，>0 = 有在飞底层 I/O
      activeRequests: incident.activeRequests,
      activeHandles: incident.activeHandles,
      probePhase: this.state.phase,
      incidentIndex: this.incidentCount,
    });
  }

  /** 最近一次阻塞事件（阶段级归因；`null` = 尚无） */
  getLastIncident(): LoopIncident | null {
    return this.lastIncident;
  }

  /** 已记录的阻塞事件数 */
  getIncidentCount(): number {
    return this.incidentCount;
  }

  /** 启动 profiler 并安排"超时丢弃"守卫 */
  private async arm(): Promise<void> {
    const session = new Session();
    session.connect();
    await post(session, 'Profiler.enable');
    await post(session, 'Profiler.start', {
      samplingInterval: this.config.samplingIntervalUs,
    });
    this.session = session;
    this.clearArmTimer();
    this.armTimer = setTimeout(() => {
      void this.handleArmTimeout().catch((err) =>
        this.reportFailure('arm-timeout', err)
      );
    }, this.config.armTimeoutMs);
    this.armTimer.unref(); // 不因探针定时器阻止进程退出
    logger.info('事件循环探针：已就绪，等待下一次阻塞（守株待兔）', {
      samplingIntervalUs: this.config.samplingIntervalUs,
      armTimeoutMs: this.config.armTimeoutMs,
      armLagMs: this.state.armLagMs,
    });
  }

  /** arm 超时：丢弃该份并回到待命（保证 profiler 不会长期在场导致内存无界增长） */
  private async handleArmTimeout(): Promise<void> {
    const decision = decideOnArmTimeout(this.state, Date.now(), this.config);
    this.state = decision.state;
    if (decision.action !== 'discard') return;
    await this.stopSession();
    logger.info('事件循环探针：等待超时，已丢弃本次采样并回到待命', {
      armTimeoutMs: this.config.armTimeoutMs,
      dumps: this.state.dumps,
    });
  }

  /** 转储：停 profiler → 归因 → 落盘 */
  private async dump(lagMs: number): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const profile = await this.stopAndTakeProfile();
      if (!profile) return;

      const mem = process.memoryUsage();
      const phases = snapshotPhases(lagMs);
      const summary = summarizeProfile(profile);
      const at = Date.now();
      const artifactDir = await this.writeArtifacts({
        lagMs,
        at,
        mem,
        phases,
        summary,
        profile,
      });

      logger.warn('事件循环探针：已转储阻塞归因', {
        lagMs,
        dumps: this.state.dumps,
        phase: this.state.phase,
        suspectPhases: phases.suspects.map((p) => ({
          name: p.name,
          durationMs: p.durationMs,
        })),
        currentPhase: phases.current,
        profileTop: summary.top.slice(0, 5),
        gcPct: summary.gcPct,
        sampleCount: summary.sampleCount,
        artifactDir,
      });
    } finally {
      this.busy = false;
    }
  }

  private async stopAndTakeProfile(): Promise<CpuProfileLike | null> {
    const session = this.session;
    if (!session) return null;
    this.clearArmTimer();
    try {
      const result = (await post(session, 'Profiler.stop')) as {
        profile?: CpuProfileLike;
      };
      return result.profile ?? null;
    } finally {
      await this.stopSession();
    }
  }

  private async stopSession(): Promise<void> {
    this.clearArmTimer();
    const session = this.session;
    this.session = null;
    if (!session) return;
    try {
      session.disconnect();
    } catch (err) {
      // @ignore-catch — disconnect 失败不影响后续（Session 已不可用），仅记录
      logger.debug('事件循环探针：inspector disconnect 失败（忽略）', {
        error: String(err),
      });
    }
  }

  private clearArmTimer(): void {
    if (this.armTimer) {
      clearTimeout(this.armTimer);
      this.armTimer = null;
    }
  }

  private async writeArtifacts(input: {
    lagMs: number;
    at: number;
    mem: NodeJS.MemoryUsage;
    phases: PhaseSnapshot;
    summary: ProfileSummary;
    profile: CpuProfileLike;
  }): Promise<string> {
    const base = join(resolveDataSubDir('artifacts'), LOOP_PROBE_DIR_NAME);
    const stamp = new Date(input.at).toISOString().replace(/[:.]/g, '-');
    const dir = join(base, `${stamp}_lag${Math.round(input.lagMs)}`);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'profile.cpuprofile'),
      JSON.stringify(input.profile)
    );
    await writeFile(
      join(dir, 'summary.md'),
      renderSummaryMarkdown(
        input.lagMs,
        input.at,
        input.mem,
        input.phases,
        input.summary
      )
    );
    return dir;
  }

  private reportFailure(stage: string, err: unknown): void {
    // 探针失败不得影响主流程；但必须留痕（CS03：回退不得掩盖错误）
    void handleError(err, {
      module: 'diagnostics:loop-probe',
      action: stage,
    });
  }

  /** 复位（测试 / 手动重启探针） */
  async reset(): Promise<void> {
    this.clearArmTimer();
    await this.stopSession();
    this.state = initProbeState();
    this.busy = false;
    this.lastIncident = null;
    this.incidentCount = 0;
  }
}

/** 渲染可机读（也便于 LLM 判读）的归因摘要 */
export function renderSummaryMarkdown(
  lagMs: number,
  at: number,
  mem: NodeJS.MemoryUsage,
  phases: PhaseSnapshot,
  summary: ProfileSummary
): string {
  const mb = (n: number): number => Math.round(n / 1048576);
  const suspectLines =
    phases.suspects.length > 0
      ? phases.suspects
          .map((p) => `- \`${p.name}\` — 自记时长 **${p.durationMs}ms**`)
          .join('\n')
      : '- （**无**已插桩阶段与之匹配 ⇒ 阻塞来自未插桩路径或 GC/native）';
  const recentLines = phases.recent
    .map((p) => `- ${p.name}: ${p.durationMs}ms`)
    .join('\n');
  const topLines = summary.top
    .map(
      (h, i) =>
        `${i + 1}. \`${h.fn}\` — ${h.ms}ms (${h.pct}%) @ ${h.url}:${h.line}`
    )
    .join('\n');
  const fileLines = summary.topFiles
    .map((f) => `- ${f.file}: ${f.ms}ms (${f.pct}%)`)
    .join('\n');

  return [
    '# 事件循环阻塞归因（探针自动生成）',
    '',
    `- 触发时刻：${new Date(at).toISOString()}`,
    `- 心跳测得滞后（lag）：**${lagMs}ms**`,
    `- 内存：rss ${mb(mem.rss)}MB / heapUsed ${mb(mem.heapUsed)}MB / heapTotal ${mb(mem.heapTotal)}MB / external ${mb(mem.external)}MB`,
    `- 采样：${summary.sampleCount} 点，覆盖 ${summary.totalMs}ms`,
    '',
    '## 阶段归因（P2 自记时长 × 心跳 lag 互相印证）',
    '',
    `当前活跃阶段：${phases.current ?? '（无）'}`,
    '',
    '**疑似阻塞阶段**（自记时长 ≥ max(1s, lag/2)）：',
    suspectLines,
    '',
    '最近完成阶段（新→旧，前 12 条）：',
    recentLines || '- （无）',
    '',
    '## CPU 热点（self time top 20）',
    '',
    topLines || '- （无采样）',
    '',
    '## 文件级聚合（top 5）',
    '',
    fileLines || '- （无采样）',
    '',
    `## GC / 运行时占比`,
    '',
    `- GC/program 帧占比：**${summary.gcPct}%**`,
    '',
    '## 判读口径（四分类）',
    '',
    '- **A. JS 同步计算**：疑似阶段非空，且 top 函数落在该阶段所属模块内；',
    '- **B. GC/分配**：GC/program 占比高，且无阶段匹配；',
    '- **C. native/系统调用**：无阶段匹配、JS 热点占比低、栈顶停在 fs/sqlite3/Bun.*；',
    '- ⚠ 单一 profile 不足以定论：需 ≥5 次一致 + `process.cpuUsage` 的 sys 增量 / `_getActiveRequests` 交叉验证（方案 §6 风险表）。',
    '',
  ].join('\n');
}

/** 全局单例（挂载点用；测试请直接 `new LoopProbe(config)`） */
export const loopProbe = new LoopProbe();

/**
 * 心跳挂载入口：由 `EventLoopLagMonitor` 在**已判定为真实阻塞**（非睡眠唤醒）时调用。
 * 关闭档位时为一次布尔判定。
 */
export function onLoopLag(lagMs: number): void {
  loopProbe.onLag(lagMs);
}

/** 测试辅助：重置单例与阶段栈 */
export async function resetLoopProbeForTest(): Promise<void> {
  await loopProbe.reset();
  resetPhaseStack();
}
