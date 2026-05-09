/**
 * 分析服务入口
 *
 * 提供事件日志记录的核心接口。事件先入队，应用初始化时 attachAnalyticsSink() 后
 * 再批量处理。参考 CC源码 cc_code/backend/services/analytics/index.ts
 */

export type AnalyticsSink = {
  logEvent: (
    eventName: string,
    metadata: Record<string, boolean | number | string | undefined>
  ) => void;
  logEventAsync: (
    eventName: string,
    metadata: Record<string, boolean | number | string | undefined>
  ) => Promise<void>;
};

type QueuedEvent = {
  eventName: string;
  metadata: Record<string, boolean | number | string | undefined>;
  async: boolean;
};

const eventQueue: QueuedEvent[] = [];
let sink: AnalyticsSink | null = null;

export function attachAnalyticsSink(newSink: AnalyticsSink): void {
  if (sink !== null) return;
  sink = newSink;

  queueMicrotask(() => {
    while (eventQueue.length > 0) {
      const event = eventQueue.shift();
      if (event) {
        try {
          if (event.async) {
            sink!
              .logEventAsync(event.eventName, event.metadata)
              .catch(() => {});
          } else {
            sink!.logEvent(event.eventName, event.metadata);
          }
        } catch {
          // 静默处理，防止分析异常影响主流程
        }
      }
    }
  });
}

export function detachAnalyticsSink(): void {
  sink = null;
}

export function logEvent(
  eventName: string,
  metadata: Record<string, boolean | number | string | undefined> = {}
): void {
  if (sink) {
    try {
      sink.logEvent(eventName, metadata);
    } catch {
      // 静默处理
    }
  } else {
    eventQueue.push({ eventName, metadata, async: false });
  }
}

export async function logEventAsync(
  eventName: string,
  metadata: Record<string, boolean | number | string | undefined> = {}
): Promise<void> {
  if (sink) {
    try {
      await sink.logEventAsync(eventName, metadata);
    } catch {
      // 静默处理
    }
  } else {
    eventQueue.push({ eventName, metadata, async: true });
  }
}

export function getQueuedEventCount(): number {
  return eventQueue.length;
}

export function flushQueue(): void {
  if (!sink) return;
  while (eventQueue.length > 0) {
    const event = eventQueue.shift();
    if (event) {
      try {
        sink.logEvent(event.eventName, event.metadata);
      } catch {
        // 静默处理
      }
    }
  }
}
