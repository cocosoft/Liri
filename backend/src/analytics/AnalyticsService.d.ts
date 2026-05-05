/**
 * AnalyticsService 类型声明
 */
declare class AnalyticsService {
  static instance: AnalyticsService;
  static getInstance(): AnalyticsService;

  events: any[];
  sessions: Map<string, any>;
  eventSequence: number;
  maxEvents: number;
  maxSessions: number;
  sessionTimeout: number;

  constructor();

  trackEvent(type: string, name: string, metadata?: Record<string, any>): string;
  logEvent(eventName: string, metadata?: Record<string, any>): void;
  startSession(userId: string): string;
  endSession(sessionId: string): void;
  updateSessionActivity(sessionId: string, operationType: string, duration: number): void;
  getSession(sessionId: string): any;
  getAllSessions(): any[];
  getEvents(options?: { type?: string; name?: string; startTime?: number; endTime?: number; limit?: number }): any[];
  cleanupInactiveSessions(): number;
  getStats(): {
    totalEvents: number;
    totalSessions: number;
    activeSessions: number;
    eventCounts: Record<string, number>;
    averageSessionDuration: number;
  };
  exportData(format?: string): any;
  clearData(): void;
  reset(): void;
  on(event: string, listener: (...args: any[]) => void): this;
  emit(event: string, ...args: any[]): boolean;
}

export { AnalyticsService };
export declare const analyticsService: AnalyticsService;
