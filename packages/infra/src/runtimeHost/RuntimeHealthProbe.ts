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
 * RuntimeHealthProbe — 进程运行时健康探针
 *
 * **为什么需要（真机实证，2026-11-08）**：daemon 反复「静默退出」——app.log 无
 * fatal/uncaught、`last-exit.json` 不更新（仍是旧记录），残留锁被下次启动记为
 * `last-abnormal.json`。这类退出**不触发任何 JS 退出事件**（外部强杀 / OOM /
 * 原生崩溃），`ExitRecorder` 无从记录 ⇒ 只能靠**退出前的心跳**推断。
 *
 * 本探针周期性采样内存与事件循环延迟，覆盖式落盘 `runtime-health.json`：
 * - **被外部强杀**：心跳时间戳停在死亡前一刻，且下次启动无 last-exit ⇒ 可区分；
 * - **事件循环卡死**：心跳仍在写，但 `eventLoopLagMs` 飙升 ⇒ 可区分；
 * - **内存泄漏型退出**：`rssMb` 斜率可回溯（启动即 ~1GB、逐轮上涨）。
 *
 * 每次启动把上一次进程的末次心跳**追加**到 `runtime-health-prev.jsonl`（一进程一行），
 * 重启风暴下可回看「每一轮活到几点 / 死前 RSS 多少」而**不丢历史** —— 覆盖式单文件
 * 会在下一次启动时把上一次的证据抹掉（真实事故：2026-11-08 pid 1976 的末次心跳就因此丢失）。
 */

import fs from 'fs';
import path from 'path';
import { resolveDataDir } from '@openliri/infra/environment';
import { writeFileAtomic } from '@openliri/infra/utils/atomicFileWrite';
import { outboundFetch } from '@openliri/infra/utils/outboundFetch';
import { getLogger } from '@openliri/kernel/loggerFacade';

import {
  RUNTIME_HEALTH_LAG_WARN_COOLDOWN_MS,
  RUNTIME_HEALTH_LAG_WARN_MS,
  RUNTIME_HEALTH_PROBE_INTERVAL_MS,
} from './defaults';

const logger = getLogger('infra:runtime-health');

/** 单次采样快照 */
export interface RuntimeHealthSnapshot {
  /** 采样时间（ISO） */
  at: string;
  pid: number;
  /** 探针启动时间（≈进程启动时刻） */
  startedAt: string;
  uptimeMs: number;
  rssMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
  externalMb: number;
  /** 比标称周期多出的延迟（ms）——事件循环阻塞程度的近似值 */
  eventLoopLagMs: number;
}

export interface RuntimeHealthProbeOptions {
  /** 采样间隔（ms），默认 15s */
  intervalMs?: number;
  /** 心跳落盘目录，默认 `resolveDataDir()`（测试可注入） */
  dataDir?: string;
}

/** 内存告警阈值（MB）：跨过新阈值才告警，避免每轮刷屏 */
const RSS_WARN_THRESHOLDS_MB = [1500, 2000, 3000] as const;

let timer: ReturnType<typeof setInterval> | null = null;
let latest: RuntimeHealthSnapshot | null = null;
let startedAt = new Date().toISOString();
let intervalMs = RUNTIME_HEALTH_PROBE_INTERVAL_MS;
let dataDir: string | null = null;
let lastTickAt = 0;
let warnedRssThresholdMb = 0;
let lastLagWarnAt = 0;

function toMb(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}

function healthFile(dir: string): string {
  return path.join(dir, 'runtime-health.json');
}

/** 上一次进程末次心跳的落点（JSONL：一进程一行，只追加） */
function previousHeartbeatFile(dir: string): string {
  return path.join(dir, 'runtime-health-prev.jsonl');
}

/**
 * 把上一次进程的末次心跳**追加**到 prev（同进程重启探针则不追加）。
 *
 * 2026-11-08（pid 1976 取证）：此前是**覆盖写**单文件 ⇒ 09:11 启动转存了 1976 的末次心跳，
 * 09:18 再启动即被 22744 覆盖，事故证据只存在 7 分钟。改为追加后每次启动各留一行。
 *
 * 心跳文件本身是**缩进 JSON**（多行），故这里 parse 后重新压成单行再追加，
 * 保证 JSONL「一行一条」不被打散。
 */
function preservePreviousHeartbeat(dir: string): void {
  const current = healthFile(dir);
  try {
    if (!fs.existsSync(current)) return;
    const raw = fs.readFileSync(current, 'utf-8');
    const parsed = JSON.parse(raw) as { pid?: number };
    if (parsed.pid === process.pid) return;
    fs.appendFileSync(previousHeartbeatFile(dir), `${JSON.stringify(parsed)}\n`);
  } catch (err) {
    // @ignore-catch — 转存失败只影响事后取证，不阻断探针
    logger.warn('转存上次运行时心跳失败', { error: String(err) });
  }
}

/** 采样一次（同时作为事件循环延迟的测量点） */
function sample(): RuntimeHealthSnapshot {
  const now = Date.now();
  const lag = lastTickAt > 0 ? Math.max(0, now - lastTickAt - intervalMs) : 0;
  lastTickAt = now;
  const usage = process.memoryUsage();
  const snapshot: RuntimeHealthSnapshot = {
    at: new Date(now).toISOString(),
    pid: process.pid,
    startedAt,
    uptimeMs: Math.round(process.uptime() * 1000),
    rssMb: toMb(usage.rss),
    heapUsedMb: toMb(usage.heapUsed),
    heapTotalMb: toMb(usage.heapTotal),
    externalMb: toMb(usage.external),
    eventLoopLagMs: Math.round(lag),
  };
  latest = snapshot;
  return snapshot;
}

function persist(dir: string, snapshot: RuntimeHealthSnapshot): void {
  // @ignore-catch — 心跳写盘失败不影响主流程（观测数据，非业务状态）
  writeFileAtomic(healthFile(dir), JSON.stringify(snapshot, null, 2)).catch(
    (err: unknown) => {
      logger.warn('写入运行时心跳失败', { error: String(err) });
    }
  );
}

function warnIfNeeded(snapshot: RuntimeHealthSnapshot): void {
  const crossed = RSS_WARN_THRESHOLDS_MB.filter((t) => snapshot.rssMb >= t);
  const highest = crossed.length > 0 ? crossed[crossed.length - 1] : 0;
  if (highest > warnedRssThresholdMb) {
    warnedRssThresholdMb = highest;
    logger.warn('运行时内存超过阈值', {
      pid: snapshot.pid,
      thresholdMb: highest,
      rssMb: snapshot.rssMb,
      heapUsedMb: snapshot.heapUsedMb,
      uptimeMs: snapshot.uptimeMs,
    });
  }

  if (snapshot.eventLoopLagMs >= RUNTIME_HEALTH_LAG_WARN_MS) {
    const now = Date.now();
    if (now - lastLagWarnAt >= RUNTIME_HEALTH_LAG_WARN_COOLDOWN_MS) {
      lastLagWarnAt = now;
      logger.warn('事件循环阻塞', {
        pid: snapshot.pid,
        eventLoopLagMs: snapshot.eventLoopLagMs,
        rssMb: snapshot.rssMb,
      });
    }
  }
}

/**
 * 启动运行时健康探针（幂等）。
 *
 * 定时器 `unref()`：不阻止 CLI 等短生命周期模式自然退出。
 */
export function startRuntimeHealthProbe(
  options: RuntimeHealthProbeOptions = {}
): void {
  if (timer) return;
  intervalMs = options.intervalMs ?? RUNTIME_HEALTH_PROBE_INTERVAL_MS;
  dataDir = options.dataDir ?? resolveDataDir();
  startedAt = new Date().toISOString();
  lastTickAt = 0;
  preservePreviousHeartbeat(dataDir);

  const tick = (): void => {
    const snapshot = sample();
    persist(dataDir as string, snapshot);
    warnIfNeeded(snapshot);
  };
  tick();
  timer = setInterval(tick, intervalMs);
  (timer as { unref?: () => void }).unref?.();

  logger.info('运行时健康探针已启动', {
    pid: process.pid,
    intervalMs,
    healthFile: healthFile(dataDir),
  });
}

/** 停止探针（测试/优雅退出用） */
export function stopRuntimeHealthProbe(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  latest = null;
  dataDir = null;
  lastTickAt = 0;
  warnedRssThresholdMb = 0;
  lastLagWarnAt = 0;
}

/** 读取最近一次采样；探针未启动时按需采样（不落盘） */
export function getRuntimeHealthSnapshot(): RuntimeHealthSnapshot {
  return latest ?? sample();
}

export interface HealthProbeResult {
  ok: boolean;
  attempts: number;
  elapsedMs: number;
  httpStatus?: number;
  error?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 自身 /health 就绪探测（指数退避）。
 *
 * 用于 daemon 启动/重启窗口：`listen` 成功 ≠ 业务路由可用（`_appReady`、路由注册），
 * 以退避重试确认真正可用，避免外部只看到 ECONNREFUSED 而错过就绪时刻。
 */
export async function probeHealthWithBackoff(
  baseUrl: string,
  options: {
    maxAttempts?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    timeoutMs?: number;
  } = {}
): Promise<HealthProbeResult> {
  const maxAttempts = options.maxAttempts ?? 6;
  const maxDelayMs = options.maxDelayMs ?? 3_200;
  const timeoutMs = options.timeoutMs ?? 2_000;
  const url = `${baseUrl.replace(/\/+$/, '')}/health`;
  const startedAtMs = Date.now();
  let delay = options.initialDelayMs ?? 200;
  let lastError = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) await sleep(delay);
    delay = Math.min(delay * 2, maxDelayMs);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await outboundFetch(url, { signal: controller.signal });
      if (res.ok) {
        return {
          ok: true,
          attempts: attempt,
          elapsedMs: Date.now() - startedAtMs,
          httpStatus: res.status,
        };
      }
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return {
    ok: false,
    attempts: maxAttempts,
    elapsedMs: Date.now() - startedAtMs,
    error: lastError,
  };
}
