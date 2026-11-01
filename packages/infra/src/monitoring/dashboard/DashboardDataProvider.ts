export interface DataPoint {
  timestamp: number;
  value: number;
  labels?: Record<string, string>;
}

export interface TimeSeries {
  metric: string;
  dataPoints: DataPoint[];
  unit?: string;
}

export interface DashboardWidget {
  id: string;
  title: string;
  type: 'line' | 'bar' | 'gauge' | 'table' | 'stat';
  metric: string;
  timeRange: number;
  refreshInterval: number;
}

export interface DashboardSnapshot {
  widgetId: string;
  title: string;
  type: string;
  series: TimeSeries[];
  summary: {
    current: number;
    average: number;
    min: number;
    max: number;
    count: number;
  };
  generatedAt: number;
}

export interface TimeRangeSummary {
  startTime: number;
  endTime: number;
  dataPoints: number;
  metrics: string[];
}

export interface IDashboardDataProvider {
  recordDataPoint(
    metric: string,
    value: number,
    labels?: Record<string, string>
  ): void;
  recordBatch(
    dataPoints: {
      metric: string;
      value: number;
      labels?: Record<string, string>;
    }[]
  ): void;
  getTimeSeries(
    metric: string,
    duration: number,
    aggregation?: 'avg' | 'sum' | 'min' | 'max' | 'count'
  ): TimeSeries;
  getWidgetSnapshot(widget: DashboardWidget): DashboardSnapshot;
  getRecentMetrics(limit?: number): string[];
  getTimeRangeSummary(startTime: number, endTime: number): TimeRangeSummary;
  prune(maxAge: number): number;
  clear(): void;
}

export class DashboardDataProvider implements IDashboardDataProvider {
  private store: Map<string, DataPoint[]> = new Map();
  private maxDataPoints = 100000;

  recordDataPoint(
    metric: string,
    value: number,
    labels?: Record<string, string>
  ): void {
    if (!this.store.has(metric)) {
      this.store.set(metric, []);
    }
    const points = this.store.get(metric)!;
    points.push({ timestamp: Date.now(), value, labels });
    if (points.length > this.maxDataPoints) {
      points.splice(0, Math.floor(this.maxDataPoints * 0.1));
    }
  }

  recordBatch(
    dataPoints: {
      metric: string;
      value: number;
      labels?: Record<string, string>;
    }[]
  ): void {
    for (const dp of dataPoints) {
      this.recordDataPoint(dp.metric, dp.value, dp.labels);
    }
  }

  getTimeSeries(
    metric: string,
    duration: number,
    aggregation: 'avg' | 'sum' | 'min' | 'max' | 'count' = 'avg'
  ): TimeSeries {
    const cutoff = Date.now() - duration;
    const points = (this.store.get(metric) || []).filter(
      (p) => p.timestamp >= cutoff
    );

    if (points.length === 0) {
      return { metric, dataPoints: [] };
    }

    const interval = Math.max(1, Math.floor(duration / 60));
    const buckets = new Map<number, number[]>();
    for (const p of points) {
      const bucketKey = Math.floor(p.timestamp / interval) * interval;
      if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
      buckets.get(bucketKey)!.push(p.value);
    }

    const dataPoints: DataPoint[] = [];
    for (const [bucketTime, values] of buckets) {
      let aggregated: number;
      switch (aggregation) {
        case 'sum':
          aggregated = values.reduce((s, v) => s + v, 0);
          break;
        case 'min':
          aggregated = Math.min(...values);
          break;
        case 'max':
          aggregated = Math.max(...values);
          break;
        case 'count':
          aggregated = values.length;
          break;
        default:
          aggregated = values.reduce((s, v) => s + v, 0) / values.length;
      }
      dataPoints.push({
        timestamp: bucketTime,
        value: Math.round(aggregated * 100) / 100,
      });
    }

    dataPoints.sort((a, b) => a.timestamp - b.timestamp);
    return { metric, dataPoints };
  }

  getWidgetSnapshot(widget: DashboardWidget): DashboardSnapshot {
    const series = this.getTimeSeries(widget.metric, widget.timeRange);
    const values = series.dataPoints.map((p) => p.value);
    const summary = {
      current: values.length > 0 ? values[values.length - 1] : 0,
      average:
        values.length > 0
          ? Math.round(
              (values.reduce((s, v) => s + v, 0) / values.length) * 100
            ) / 100
          : 0,
      min: values.length > 0 ? Math.round(Math.min(...values) * 100) / 100 : 0,
      max: values.length > 0 ? Math.round(Math.max(...values) * 100) / 100 : 0,
      count: values.length,
    };
    return {
      widgetId: widget.id,
      title: widget.title,
      type: widget.type,
      series: [series],
      summary,
      generatedAt: Date.now(),
    };
  }

  getRecentMetrics(limit: number = 20): string[] {
    return Array.from(this.store.keys()).slice(0, limit);
  }

  getTimeRangeSummary(startTime: number, endTime: number): TimeRangeSummary {
    const metrics = new Set<string>();
    let dataPoints = 0;
    for (const [metric, points] of this.store) {
      const filtered = points.filter(
        (p) => p.timestamp >= startTime && p.timestamp <= endTime
      );
      if (filtered.length > 0) {
        metrics.add(metric);
        dataPoints += filtered.length;
      }
    }
    return { startTime, endTime, dataPoints, metrics: Array.from(metrics) };
  }

  prune(maxAge: number): number {
    const cutoff = Date.now() - maxAge;
    let total = 0;
    for (const [metric, points] of this.store) {
      const before = points.length;
      this.store.set(
        metric,
        points.filter((p) => p.timestamp > cutoff)
      );
      total += before - this.store.get(metric)!.length;
    }
    return total;
  }

  clear(): void {
    this.store.clear();
  }
}
