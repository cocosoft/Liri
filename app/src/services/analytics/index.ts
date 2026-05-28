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
