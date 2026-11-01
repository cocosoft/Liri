export interface TrendPoint {
  timestamp: number;
  hitRate: number;
  missRate: number;
  avgLatency: number;
  memoryUsage: number;
  itemCount: number;
}

export interface TrendAnalysis {
  direction: 'improving' | 'degrading' | 'stable';
  hitRateTrend: number;
  latencyTrend: number;
  memoryTrend: number;
  confidence: number;
  points: TrendPoint[];
}

export interface Anomaly {
  type: 'hit_rate_drop' | 'latency_spike' | 'memory_surge' | 'throughput_drop';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  timestamp: number;
  value: number;
  threshold: number;
}

export interface CacheReport {
  generatedAt: number;
  periodMs: number;
  metrics: {
    avgHitRate: number;
    avgLatency: number;
    memoryUsage: number;
    totalOperations: number;
  };
  anomalies: Anomaly[];
  trends: TrendAnalysis[];
  recommendations: string[];
  healthScore: number;
}

export interface IEnhancedCacheMonitor {
  recordSample(point: Omit<TrendPoint, 'timestamp'>): void;
  analyzeTrends(periodMs?: number, intervalCount?: number): TrendAnalysis[];
  detectAnomalies(periodMs?: number): Anomaly[];
  generateReport(periodMs?: number): CacheReport;
  getHealthScore(): number;
  clear(): void;
}

export class EnhancedCacheMonitor implements IEnhancedCacheMonitor {
  private trendPoints: TrendPoint[] = [];
  private maxPoints = 10000;

  recordSample(point: Omit<TrendPoint, 'timestamp'>): void {
    this.trendPoints.push({ ...point, timestamp: Date.now() });
    if (this.trendPoints.length > this.maxPoints) {
      this.trendPoints = this.trendPoints.slice(
        -Math.floor(this.maxPoints * 0.5)
      );
    }
  }

  analyzeTrends(
    periodMs: number = 300000,
    intervalCount: number = 10
  ): TrendAnalysis[] {
    const now = Date.now();
    const intervalSize = periodMs / intervalCount;
    const result: TrendAnalysis[] = [];

    const metricsToAnalyze: Array<{
      name: string;
      extract: (p: TrendPoint) => number;
    }> = [
      { name: 'hitRate', extract: (p) => p.hitRate },
      { name: 'latency', extract: (p) => p.avgLatency },
      { name: 'memory', extract: (p) => p.memoryUsage },
    ];

    for (const metric of metricsToAnalyze) {
      const intervals: number[][] = [];
      for (let i = 0; i < intervalCount; i++) {
        const start = now - (i + 1) * intervalSize;
        const end = now - i * intervalSize;
        const points = this.trendPoints.filter(
          (p) => p.timestamp >= start && p.timestamp < end
        );
        intervals.push(points.map((p) => metric.extract(p)));
      }

      const intervalAverages = intervals.map((vals) =>
        vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
      );

      const recentAvg =
        intervalAverages
          .slice(0, Math.ceil(intervalCount / 2))
          .reduce((a, b) => a + b, 0) / Math.ceil(intervalCount / 2);
      const olderAvg =
        intervalAverages
          .slice(Math.ceil(intervalCount / 2))
          .reduce((a, b) => a + b, 0) / Math.floor(intervalCount / 2) ||
        recentAvg;

      const trendValue = olderAvg > 0 ? (recentAvg - olderAvg) / olderAvg : 0;
      let direction: TrendAnalysis['direction'] = 'stable';
      const threshold = 0.05;

      if (metric.name === 'hitRate') {
        if (trendValue > threshold) direction = 'improving';
        else if (trendValue < -threshold) direction = 'degrading';
      } else {
        if (trendValue < -threshold) direction = 'improving';
        else if (trendValue > threshold) direction = 'degrading';
      }

      const points = this.trendPoints.filter(
        (p) => p.timestamp > now - periodMs
      );

      result.push({
        direction,
        hitRateTrend: metric.name === 'hitRate' ? trendValue : 0,
        latencyTrend: metric.name === 'latency' ? trendValue : 0,
        memoryTrend: metric.name === 'memory' ? trendValue : 0,
        confidence: Math.min(1, points.length / intervalCount),
        points: points.slice(-intervalCount),
      });
    }

    return result;
  }

  detectAnomalies(periodMs: number = 300000): Anomaly[] {
    const now = Date.now();
    const recent = this.trendPoints.filter((p) => p.timestamp > now - periodMs);
    const anomalies: Anomaly[] = [];

    if (recent.length < 5) return anomalies;

    const avgHitRate =
      recent.reduce((s, p) => s + p.hitRate, 0) / recent.length;
    const avgLatency =
      recent.reduce((s, p) => s + p.avgLatency, 0) / recent.length;
    const avgMemory =
      recent.reduce((s, p) => s + p.memoryUsage, 0) / recent.length;

    const latest = recent[recent.length - 1];

    const hitRateDrop = avgHitRate - latest.hitRate;
    if (hitRateDrop > 0.1) {
      anomalies.push({
        type: 'hit_rate_drop',
        severity:
          hitRateDrop > 0.3
            ? 'critical'
            : hitRateDrop > 0.2
              ? 'high'
              : 'medium',
        message: `Hit rate dropped from ${(avgHitRate * 100).toFixed(1)}% to ${(latest.hitRate * 100).toFixed(1)}%`,
        timestamp: now,
        value: latest.hitRate,
        threshold: avgHitRate - 0.1,
      });
    }

    if (avgLatency > 0 && latest.avgLatency > avgLatency * 2) {
      anomalies.push({
        type: 'latency_spike',
        severity: latest.avgLatency > avgLatency * 5 ? 'critical' : 'high',
        message: `Latency spike: ${latest.avgLatency.toFixed(1)}ms vs avg ${avgLatency.toFixed(1)}ms`,
        timestamp: now,
        value: latest.avgLatency,
        threshold: avgLatency * 2,
      });
    }

    if (latest.memoryUsage > avgMemory * 1.5 && avgMemory > 0) {
      anomalies.push({
        type: 'memory_surge',
        severity: latest.memoryUsage > avgMemory * 3 ? 'critical' : 'high',
        message: `Memory surge: ${(latest.memoryUsage / 1024 / 1024).toFixed(1)}MB vs avg ${(avgMemory / 1024 / 1024).toFixed(1)}MB`,
        timestamp: now,
        value: latest.memoryUsage,
        threshold: avgMemory * 1.5,
      });
    }

    return anomalies;
  }

  generateReport(periodMs: number = 300000): CacheReport {
    const now = Date.now();
    const recent = this.trendPoints.filter((p) => p.timestamp > now - periodMs);

    const avgHitRate =
      recent.length > 0
        ? recent.reduce((s, p) => s + p.hitRate, 0) / recent.length
        : 0;
    const avgLatency =
      recent.length > 0
        ? recent.reduce((s, p) => s + p.avgLatency, 0) / recent.length
        : 0;
    const avgMemory =
      recent.length > 0
        ? recent.reduce((s, p) => s + p.memoryUsage, 0) / recent.length
        : 0;

    const anomalies = this.detectAnomalies(periodMs);
    const trends = this.analyzeTrends(periodMs);

    const recommendations: string[] = [];
    if (avgHitRate < 0.8) {
      recommendations.push(
        'Low hit rate: consider increasing cache TTL or reviewing eviction strategy'
      );
    }
    if (avgLatency > 50) {
      recommendations.push(
        'High latency: consider using batch operations or optimizing cache storage'
      );
    }
    if (anomalies.length > 0) {
      recommendations.push(
        `Address ${anomalies.length} detected anomalies to improve cache health`
      );
    }

    const degradingTrends = trends.filter((t) => t.direction === 'degrading');
    if (degradingTrends.length > 0) {
      recommendations.push(
        `${degradingTrends.length} metrics showing degradation trend, investigate root cause`
      );
    }

    let healthScore = 100;
    healthScore -= Math.round((1 - avgHitRate) * 30);
    healthScore -= Math.round(Math.min(avgLatency / 100, 1) * 20);
    healthScore -= Math.round((avgMemory > 0 ? 1 : 0) * 10);
    healthScore -= anomalies.length * 10;
    healthScore = Math.max(0, Math.min(100, healthScore));

    return {
      generatedAt: now,
      periodMs,
      metrics: {
        avgHitRate: Math.round(avgHitRate * 1000) / 1000,
        avgLatency: Math.round(avgLatency * 100) / 100,
        memoryUsage: avgMemory,
        totalOperations: recent.length,
      },
      anomalies,
      trends,
      recommendations,
      healthScore,
    };
  }

  getHealthScore(): number {
    return this.generateReport().healthScore;
  }

  clear(): void {
    this.trendPoints = [];
  }
}

export const enhancedCacheMonitor = new EnhancedCacheMonitor();
