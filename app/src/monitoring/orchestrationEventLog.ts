/**
 * 编排事件持久化（H-2，2026-10-18）
 *
 * 背景：`OrchestrationMetrics` 是**进程内**指标 —— 进程重启即清零，生产流量窗口无法事后复算。
 * 本模块把 `orch:*` 事件追加到独立指标日志（**不进入会话事件日志**，也不影响模型可见输入）：
 *
 *   `~/.pyapp/data/metrics/orchestration-events.jsonl`
 *
 * 每行：`{ "v":1, "t":<epoch ms>, "type":"orch:...", "data":{...} }`
 *
 * 设计约束：
 * - **不阻塞事件总线**：`appendFile` 异步串行队列；写失败仅 warn，不影响编排主流程；
 * - **载荷有界**：递归脱敏（字符串截断 / 数组与键数上限 / 深度上限）⇒ 不落长文与超大对象；
 * - **有界增长**：单文件超过 `maxBytes`（缺省 8MB）时轮转为 `<file>.1`（只保留 1 份备份）；
 * - **可关闭**：`LIRI_ORCH_EVENT_LOG=0` 显式禁用（缺省开启，生产窗口需要）。
 *
 * 离线分析：`bun run analyze:orchestration-events`（`app/scripts/analyze-orchestration-events.ts`），
 * 与运行时共用 `OrchestrationEventPairer` 的配对口径。
 */

import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { configManager } from '@modules/config';
import { resolveDataSubDir } from '@modules/core/paths';
import { getLogger } from '@modules/monitoring';
import { OrchestrationEventType } from '@modules/types/orchestrationEvents';

import {
  globalEventBus,
  type EventSubscription,
} from '../core/events/EventBus';

const logger = getLogger('monitoring:orchestration-event-log');

/** 日志文件名 */
const FILE_NAME = 'orchestration-events.jsonl';

/** 单文件大小上限（超过则轮转为 `.1`） */
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

/** 单条字符串最大值（超出截断） */
const MAX_STRING_LENGTH = 256;
/** 单个数组保留的最大元素数 */
const MAX_ARRAY_ITEMS = 20;
/** 单个对象保留的最大键数 */
const MAX_OBJECT_KEYS = 50;
/** 递归深度上限（超出以占位符表示） */
const MAX_DEPTH = 3;

export interface OrchestrationEventLogOptions {
  /** 显式目录（测试用）；缺省 `resolveDataSubDir('metrics')` */
  dir?: string;
  /** 单文件上限（字节）；缺省 8MB */
  maxBytes?: number;
  /** 是否启用；缺省读 `LIRI_ORCH_EVENT_LOG`（`0` = 关闭） */
  enabled?: boolean;
}

interface EventLogState {
  subscriptions: EventSubscription[];
  dir: string;
  maxBytes: number;
  /** 当前文件大小（首次写入时取 `stat`；未知时为 `null`） */
  size: number | null;
  /** 串行写队列（保证行不交错） */
  queue: Promise<void>;
}

let state: EventLogState | null = null;

/** 指标日志路径（主文件） */
export function orchestrationEventLogPath(dir?: string): string {
  return join(dir ?? resolveDataSubDir('metrics'), FILE_NAME);
}

/**
 * 递归脱敏：只保留标量与短结构，避免把长文/大对象写进指标日志。
 */
function sanitize(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}…`
      : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) return `[array:${value.length}]`;
    return value.slice(0, MAX_ARRAY_ITEMS).map((v) => sanitize(v, depth + 1));
  }
  if (typeof value === 'object') {
    if (depth >= MAX_DEPTH) return '[object]';
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (count++ >= MAX_OBJECT_KEYS) break;
      out[key] = sanitize(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

/** 追加一行（串行队列；失败仅 warn） */
function enqueueLine(st: EventLogState, line: string): void {
  st.queue = st.queue
    .then(() => writeLine(st, line))
    .catch((err: unknown) => {
      logger.warn('编排事件写入失败（不影响主流程）', { error: String(err) });
    });
}

async function writeLine(st: EventLogState, line: string): Promise<void> {
  await mkdir(st.dir, { recursive: true });
  const file = orchestrationEventLogPath(st.dir);

  if (st.size === null) {
    try {
      st.size = (await stat(file)).size;
    } catch {
      st.size = 0;
    }
  }

  const bytes = Buffer.byteLength(line, 'utf-8');
  if (st.size + bytes > st.maxBytes) {
    const rotated = `${file}.1`;
    await rm(rotated, { force: true }).catch(() => {
      // 轮转失败不阻断当前写入
    });
    await rename(file, rotated).catch(() => {
      // 主文件尚不存在时忽略
    });
    st.size = 0;
  }

  await appendFile(file, line, 'utf-8');
  st.size += bytes;
}

/**
 * 启动持久化（幂等）
 *
 * 订阅所有编排事件并把 `{v,t,type,data}` 追加到指标日志。
 */
export function startOrchestrationEventLog(
  options: OrchestrationEventLogOptions = {}
): void {
  if (state) return;

  const enabled =
    options.enabled ?? configManager.env('LIRI_ORCH_EVENT_LOG') !== '0';
  if (!enabled) {
    logger.info('编排事件持久化已禁用（LIRI_ORCH_EVENT_LOG=0）');
    return;
  }

  const st: EventLogState = {
    subscriptions: [],
    dir: options.dir ?? resolveDataSubDir('metrics'),
    maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
    size: null,
    queue: Promise.resolve(),
  };

  for (const eventType of Object.values(OrchestrationEventType)) {
    st.subscriptions.push(
      globalEventBus.on(eventType, (payload: unknown) => {
        const line =
          JSON.stringify({
            v: 1,
            t: Date.now(),
            type: eventType,
            data: sanitize(payload),
          }) + '\n';
        enqueueLine(st, line);
      })
    );
  }

  state = st;
  logger.info('编排事件持久化已启动', {
    path: orchestrationEventLogPath(st.dir),
    maxBytes: st.maxBytes,
  });
}

/** 等待已入队写入落盘（测试 / 关停前） */
export async function flushOrchestrationEventLog(): Promise<void> {
  await state?.queue;
}

/** 停止持久化（幂等；会等待已入队写入完成） */
export async function stopOrchestrationEventLog(): Promise<void> {
  const st = state;
  if (!st) return;
  state = null;
  for (const sub of st.subscriptions) sub.unsubscribe();
  await st.queue;
  logger.info('编排事件持久化已停止');
}
