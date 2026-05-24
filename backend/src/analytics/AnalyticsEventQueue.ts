/**
 * Analytics事件队列
 * 管理事件的队列和分发
 */

import type { AnalyticsSink } from './types';

type EventMetadata = Record<string, boolean | number | string | undefined>;

interface QueuedEvent {
  eventName: string;
  metadata: EventMetadata;
  async: boolean;
  timestamp: number;
  resolve?: () => void;
}

export class AnalyticsEventQueue {
  private queue: QueuedEvent[] = [];
  private sink: AnalyticsSink | null = null;
  private isDraining: boolean = false;
  private maxQueueSize: number;
  private droppedEvents: number = 0;

  constructor(maxQueueSize: number = 10000) {
    this.maxQueueSize = maxQueueSize;
  }

  logEvent(eventName: string, metadata: EventMetadata): void {
    this.enqueueEvent(eventName, metadata, false);
  }

  async logEventAsync(
    eventName: string,
    metadata: EventMetadata
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      this.enqueueEvent(eventName, metadata, true, resolve);
    });
  }

  attachSink(sink: AnalyticsSink): void {
    if (this.sink !== null) {
      return;
    }
    this.sink = sink;
    this.drainQueue();
  }

  detachSink(): void {
    this.sink = null;
  }

  clearQueue(): void {
    this.queue = [];
  }

  getQueueSize(): number {
    return this.queue.length;
  }

  getDroppedEventsCount(): number {
    return this.droppedEvents;
  }

  resetDroppedEventsCount(): void {
    this.droppedEvents = 0;
  }

  private enqueueEvent(
    eventName: string,
    metadata: EventMetadata,
    async: boolean,
    resolve?: () => void
  ): void {
    if (this.queue.length >= this.maxQueueSize) {
      this.queue.shift();
      this.droppedEvents++;
    }

    const event: QueuedEvent = {
      eventName,
      metadata,
      async,
      timestamp: Date.now(),
      resolve,
    };

    this.queue.push(event);

    if (this.sink && !this.isDraining) {
      this.drainQueue();
    }

    if (resolve) {
      resolve();
    }
  }

  private async drainQueue(): Promise<void> {
    if (this.isDraining || !this.sink) {
      return;
    }

    this.isDraining = true;

    while (this.queue.length > 0) {
      const event = this.queue.shift();
      if (!event) continue;

      try {
        if (event.async) {
          await this.sink.logEventAsync(event.eventName, event.metadata);
        } else {
          this.sink.logEvent(event.eventName, event.metadata);
        }
      } catch (error) {
        console.error('Error processing analytics event:', error);
      }
    }

    this.isDraining = false;
  }

  getSink(): AnalyticsSink | null {
    return this.sink;
  }

  isSinkAttached(): boolean {
    return this.sink !== null;
  }
}

let globalQueue: AnalyticsEventQueue | null = null;

export function getGlobalAnalyticsQueue(): AnalyticsEventQueue {
  if (!globalQueue) {
    globalQueue = new AnalyticsEventQueue();
  }
  return globalQueue;
}

export function setGlobalAnalyticsQueue(queue: AnalyticsEventQueue): void {
  globalQueue = queue;
}
