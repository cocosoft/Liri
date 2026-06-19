import type { StructuredAnalyticsEvent } from './AnalyticsSchema';
import { configManager } from '@modules/config';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('FirstPartyEventLogger');

export type FirstPartyEventSchema = {
  eventId: string;
  eventName: string;
  timestamp: number;
  source: 'Liri';
  sourceVersion: string;
  sessionId: string;
  deviceId?: string;
  platform: string;
  properties: Record<string, unknown>;
  schemaVersion: string;
};

export interface FirstPartyEventSink {
  sendEvent(event: FirstPartyEventSchema): void;
  sendEvents(events: FirstPartyEventSchema[]): void;
  flush(): Promise<void>;
}

export class FirstPartyEventLogger implements FirstPartyEventSink {
  private events: FirstPartyEventSchema[] = [];
  private maxBatchSize: number;
  private flushInterval: number;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private sessionId: string;
  private deviceId: string;
  private platform: string;
  private sourceVersion: string;
  private enabled: boolean;
  private endpoint?: string;

  constructor(options?: {
    maxBatchSize?: number;
    flushInterval?: number;
    sessionId?: string;
    deviceId?: string;
    endpoint?: string;
    enabled?: boolean;
  }) {
    this.maxBatchSize = options?.maxBatchSize || 50;
    this.flushInterval = options?.flushInterval || 10000;
    this.sessionId = options?.sessionId || `session_${Date.now()}`;
    this.deviceId =
      options?.deviceId || configManager.env('DEVICE_ID') || 'unknown';
    this.platform = process.platform;
    this.sourceVersion = configManager.env('APP_VERSION') || '1.0.0';
    this.endpoint =
      options?.endpoint || configManager.env('FIRST_PARTY_EVENT_ENDPOINT');
    this.enabled = options?.enabled !== false;
  }

  get isEnabled(): boolean {
    return this.enabled && !!this.endpoint;
  }

  startFlushTimer(): void {
    this.stopFlushTimer();
    this.flushTimer = setInterval(() => {
      if (this.events.length > 0) {
        this.flush();
      }
    }, this.flushInterval);
  }

  stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  sendEvent(event: FirstPartyEventSchema): void {
    if (!this.isEnabled) return;
    this.events.push({
      ...event,
      source: 'Liri',
      sourceVersion: this.sourceVersion,
      sessionId: event.sessionId || this.sessionId,
      schemaVersion: event.schemaVersion || '1.1',
    });

    if (this.events.length >= this.maxBatchSize) {
      this.flush();
    }
  }

  sendEvents(events: FirstPartyEventSchema[]): void {
    for (const event of events) {
      this.sendEvent(event);
    }
  }

  async flush(): Promise<void> {
    if (!this.isEnabled || this.events.length === 0) return;

    const batch = this.events.splice(0);
    if (batch.length === 0) return;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(this.endpoint!, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source: 'Liri',
          schemaVersion: '1.1',
          events: batch,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        logger.warn('1PEvent HTTP 请求失败', { status: response.status });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        logger.warn('[1PEvent] Flush 超时');
      } else {
        logger.error('[1PEvent] Flush error:', error);
      }
    }
  }

  logFromAnalyticsEvent(
    analyticsEvent: StructuredAnalyticsEvent
  ): FirstPartyEventSchema {
    return {
      eventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      eventName: analyticsEvent.eventName,
      timestamp: analyticsEvent.timestamp,
      source: 'Liri',
      sourceVersion: this.sourceVersion,
      sessionId: analyticsEvent.sessionId || this.sessionId,
      deviceId: this.deviceId,
      platform: this.platform,
      properties: {
        ...analyticsEvent.metadata,
        category: analyticsEvent.category,
        severity: analyticsEvent.severity,
        schemaVersion: analyticsEvent.schemaVersion,
        turnId: analyticsEvent.turnId,
        correlationId: analyticsEvent.correlationId,
      },
      schemaVersion: '1.1',
    };
  }

  logExperimentExposure(options: {
    experimentId: string;
    variationId: number;
    featureId: string;
    inExperiment?: boolean;
  }): void {
    if (!this.isEnabled) return;

    this.sendEvent({
      eventId: `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      eventName: 'growthbook_experiment_exposure',
      timestamp: Date.now(),
      source: 'Liri',
      sourceVersion: this.sourceVersion,
      sessionId: this.sessionId,
      schemaVersion: '1.1',
      platform: this.platform,
      properties: {
        experiment_id: options.experimentId,
        variation_id: options.variationId,
        feature_id: options.featureId,
        in_experiment: options.inExperiment ?? true,
      },
    });
  }

  logSecurityEvent(options: {
    eventType:
      | 'command_blocked'
      | 'permission_denied'
      | 'sandbox_violation'
      | 'audit_alert';
    severity: 'low' | 'medium' | 'high' | 'critical';
    details: Record<string, unknown>;
  }): void {
    if (!this.isEnabled) return;

    this.sendEvent({
      eventId: `sec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      eventName: `security_${options.eventType}`,
      timestamp: Date.now(),
      source: 'Liri',
      sourceVersion: this.sourceVersion,
      sessionId: this.sessionId,
      schemaVersion: '1.1',
      platform: this.platform,
      properties: {
        event_type: options.eventType,
        severity: options.severity,
        ...options.details,
      },
    });
  }

  getSessionId(): string {
    return this.sessionId;
  }
}

export function createFirstPartyEventLogger(options?: {
  maxBatchSize?: number;
  flushInterval?: number;
  sessionId?: string;
  deviceId?: string;
  endpoint?: string;
}): FirstPartyEventLogger {
  return new FirstPartyEventLogger(options);
}
