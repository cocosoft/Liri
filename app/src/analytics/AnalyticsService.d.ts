/**
 * AnalyticsService 类型声明
 */
declare class AnalyticsService {
  static instance: AnalyticsService;
  static getInstance(): AnalyticsService;

  events: unknown[];
  sessions: Map<string, unknown>;
  eventSequence: number;
  maxEvents: number;
  maxSessions: number;
  sessionTimeout: number;

  constructor();

  trackEvent(
    type: string,
    name: string,
    metadata?: Record<string, unknown>
  ): string;
  logEvent(eventName: string, metadata?: Record<string, unknown>): void;
  startSession(userId: string): string;
  endSession(sessionId: string): void;
  updateSessionActivity(
    sessionId: string,
    operationType: string,
    duration: number
  ): void;
  getSession(sessionId: string): unknown;
  getAllSessions(): unknown[];
  getEvents(options?: {
    type?: string;
    name?: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
  }): unknown[];
  cleanupInactiveSessions(): number;
  getStats(): {
    totalEvents: number;
    totalSessions: number;
    activeSessions: number;
    eventCounts: Record<string, number>;
    averageSessionDuration: number;
  };
  exportData(format?: string): unknown;
  clearData(): void;
  reset(): void;
  on(event: string, listener: (...args: unknown[]) => void): this;
  emit(event: string, ...args: unknown[]): boolean;
}

export { AnalyticsService };
export declare const analyticsService: AnalyticsService;
