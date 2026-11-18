/**
 * streamAttachHub — 聊天流「只读 attach」的进程内帧缓冲与订阅（2026-11-18）
 *
 * Spec：`.trae/specs/stream-attach.md`（§4 契约 / §5.1 实现点）。
 *
 * 存在原因：`handleStreamingChat` 手动迭代生成器、逐帧 `res.write`，**没有**按会话的
 * 实时帧通道；`events.jsonl` 是语义事件（非逐 token 帧）、`/v1/events` 按身份广播、
 * checkpoint resume 是"重跑"——三者都不能让另一个客户端"接上正在输出的这一轮"。
 *
 * 本模块只做一件事：把主链路**已写出的同一帧字符串**旁路存进环形缓冲，并转发给
 * 订阅者。它不认识 `http.ServerResponse`（sink 由调用方注入），也不影响主链路字节。
 *
 * 边界（有意为之）：
 * - 内存态，进程重启即失效（重启后 attach 一律 404，恢复仍走既有检查点链路）；
 * - 只读，不接管执行、不重放工具副作用；
 * - 帧数/字节双上限，超出淘汰最旧并推进 `oldestSeq`（客户端据此得到 409 `cursor_gap`）。
 */
import { getLogger } from '@openliri/infra/monitoring';
import {
  STREAM_ATTACH_HEARTBEAT_MS,
  STREAM_ATTACH_RETENTION_MS,
} from '@openliri/infra/constants';

const logger = getLogger('http:chat:attach');

/** 心跳间隔：与主链路 `chat-handlers.ts` 的 15000ms 对齐（真源在 infra 常量） */
export const ATTACH_HEARTBEAT_MS = STREAM_ATTACH_HEARTBEAT_MS;
/** 缓冲帧数上限 */
export const ATTACH_MAX_FRAMES = 4000;
/** 缓冲字节上限（按帧字符串长度累计） */
export const ATTACH_MAX_BYTES = 8 * 1024 * 1024;
/** 本轮结束后保留时长：解决"刚结束才 attach"的竞态（仍可拿到全量 + `[DONE]`） */
export const ATTACH_RETENTION_MS = STREAM_ATTACH_RETENTION_MS;
/** 同会话 attach 订阅上限（只读端） */
export const ATTACH_MAX_SUBSCRIBERS = 3;
/** 订阅端响应缓冲上限：超过即断开该订阅（可凭 `from_seq` 重连），避免拖垮主链路 */
export const ATTACH_SLOW_CLIENT_MAX_BUFFER = 4 * 1024 * 1024;

/** 订阅端（由 HTTP handler 注入；返回 false 表示该端已不可用，hub 会摘除并 close） */
export interface AttachSink {
  /** 写入第 `seq` 帧（调用方负责 `id:` 等线格式） */
  write(seq: number, frame: string): boolean;
  /** hub 主动收尾（本轮结束 / 被新 run 顶替 / 该端积压超限） */
  close(): void;
}

export interface AttachSnapshot {
  runId: string;
  /** 回放起点（= 请求的 from_seq） */
  fromSeq: number;
  /** 已发布帧总数（下一个帧的序号） */
  nextSeq: number;
  /** 本轮是否已结束（true ⇒ 回放完即可关闭，不必订阅） */
  ended: boolean;
  /** 首帧（`attach_meta`） */
  metaFrame: string;
  /** 回放帧：`replay[i]` 的序号 = `fromSeq + i` */
  replay: string[];
}

export type AttachErrorBody = {
  error: {
    code:
      | 'no_active_run'
      | 'cursor_gap'
      | 'run_mismatch'
      | 'too_many_attachments';
    message: string;
    runId?: string;
    oldestSeq?: number;
    nextSeq?: number;
  };
};

export type OpenAttachResult =
  | {
      ok: true;
      snapshot: AttachSnapshot;
      /** 订阅实时帧；返回取消订阅。本轮已结束时为空操作 */
      addSink: (sink: AttachSink) => () => void;
    }
  | { ok: false; status: 404 | 409 | 429; body: AttachErrorBody };

export interface RunHandle {
  readonly runId: string;
  /** 主链路每写出**一帧**后调用（含尾部帧与 `[DONE]`）；本方法不抛 */
  publish(frame: string): void;
  /** 本轮结束（成功 / 异常 / 客户端断开，三条出口都要调用）；幂等 */
  end(): void;
}

interface RunEntry {
  runId: string;
  /** frames[i] 的序号 = baseSeq + i */
  frames: string[];
  baseSeq: number;
  nextSeq: number;
  bytes: number;
  ended: boolean;
  sinks: Set<AttachSink>;
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

const runs = new Map<string, RunEntry>();

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  (timer as unknown as { unref?: () => void }).unref?.();
}

function closeSinkQuietly(sink: AttachSink): void {
  try {
    sink.close();
  } catch (err) {
    logger.warn('attach 订阅端关闭失败', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** 开始一轮（每次 `handleStreamingChat` 一次；同会话旧 run 会被顶替并关闭其订阅端） */
export function beginRun(sessionId: string, runId: string): RunHandle {
  const prev = runs.get(sessionId);
  if (prev) {
    prev.ended = true;
    if (prev.cleanupTimer) clearTimeout(prev.cleanupTimer);
    for (const sink of [...prev.sinks]) closeSinkQuietly(sink);
    prev.sinks.clear();
  }

  const entry: RunEntry = {
    runId,
    frames: [],
    baseSeq: 0,
    nextSeq: 0,
    bytes: 0,
    ended: false,
    sinks: new Set(),
  };
  runs.set(sessionId, entry);

  return {
    runId,
    publish(frame: string): void {
      // 只认"当前仍是本 run"：被新 run 顶替后，遗留生成器不得污染新一轮的缓冲
      if (runs.get(sessionId) !== entry || entry.ended) return;
      try {
        const seq = entry.nextSeq;
        entry.frames.push(frame);
        entry.nextSeq++;
        entry.bytes += frame.length;
        while (
          entry.frames.length > ATTACH_MAX_FRAMES ||
          entry.bytes > ATTACH_MAX_BYTES
        ) {
          const dropped = entry.frames.shift();
          if (dropped === undefined) break;
          entry.bytes -= dropped.length;
          entry.baseSeq++;
        }
        for (const sink of [...entry.sinks]) {
          let alive = false;
          try {
            alive = sink.write(seq, frame);
          } catch (err) {
            logger.warn('attach 订阅端写入异常，摘除该订阅', {
              error: err instanceof Error ? err.message : String(err),
            });
          }
          if (!alive) {
            entry.sinks.delete(sink);
            closeSinkQuietly(sink);
          }
        }
      } catch (err) {
        // publish 不得拖垮主链路：这里是唯一的 catch，且只记录日志
        logger.warn('attach 旁路发布失败（主链路不受影响）', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    end(): void {
      if (runs.get(sessionId) !== entry || entry.ended) return;
      entry.ended = true;
      for (const sink of [...entry.sinks]) closeSinkQuietly(sink);
      entry.sinks.clear();
      entry.cleanupTimer = setTimeout(() => {
        if (runs.get(sessionId) === entry) runs.delete(sessionId);
      }, ATTACH_RETENTION_MS);
      unrefTimer(entry.cleanupTimer);
    },
  };
}

/**
 * 该会话当前是否有 attach 订阅者（宽限期内判断"是否有人接管"用，只读）。
 * 2026-11-18：Spec `.trae/specs/stream-attach-grace.md` §3.2。
 */
export function hasSubscribers(sessionId: string): boolean {
  const entry = runs.get(sessionId);
  return entry !== undefined && entry.sinks.size > 0;
}

/**
 * 打开 attach：校验游标/run 身份/订阅数并给出回放快照。
 * 失败一律显式（404/409/429），调用方不得伪造"连续"。
 */
export function openAttach(
  sessionId: string,
  fromSeq: number,
  runId?: string
): OpenAttachResult {
  const entry = runs.get(sessionId);
  if (!entry) {
    return {
      ok: false,
      status: 404,
      body: {
        error: {
          code: 'no_active_run',
          message: '该会话当前没有运行中的回复（或已超出保留期）',
        },
      },
    };
  }
  if (runId && runId !== entry.runId) {
    return {
      ok: false,
      status: 409,
      body: {
        error: {
          code: 'run_mismatch',
          message: '目标回复已更换，不能把两轮的帧拼成一条',
          runId: entry.runId,
          nextSeq: entry.nextSeq,
        },
      },
    };
  }
  const oldestSeq = entry.baseSeq;
  if (fromSeq < oldestSeq || fromSeq > entry.nextSeq) {
    return {
      ok: false,
      status: 409,
      body: {
        error: {
          code: 'cursor_gap',
          message:
            fromSeq > entry.nextSeq
              ? '游标超出已发布范围'
              : '游标已超出保留窗口（事件已被淘汰）',
          runId: entry.runId,
          oldestSeq,
          nextSeq: entry.nextSeq,
        },
      },
    };
  }
  if (!entry.ended && entry.sinks.size >= ATTACH_MAX_SUBSCRIBERS) {
    return {
      ok: false,
      status: 429,
      body: {
        error: {
          code: 'too_many_attachments',
          message: '同一会话的 attach 订阅数已达上限',
        },
      },
    };
  }

  return {
    ok: true,
    snapshot: {
      runId: entry.runId,
      fromSeq,
      nextSeq: entry.nextSeq,
      ended: entry.ended,
      metaFrame: `data: ${JSON.stringify({
        __pyapp_type: 'attach_meta',
        runId: entry.runId,
        fromSeq,
        nextSeq: entry.nextSeq,
      })}\n\n`,
      replay: entry.frames.slice(fromSeq - entry.baseSeq),
    },
    addSink(sink: AttachSink): () => void {
      if (entry.ended) return () => {};
      entry.sinks.add(sink);
      return () => {
        entry.sinks.delete(sink);
      };
    },
  };
}

/** 单测用：清空全部 run（生产路径不调用） */
export function __resetAttachHubForTest(): void {
  for (const entry of runs.values()) {
    if (entry.cleanupTimer) clearTimeout(entry.cleanupTimer);
    entry.sinks.clear();
  }
  runs.clear();
}
