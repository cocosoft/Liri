import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { IncidentManager } from './incidents/IncidentManager';
import type { Incident } from './incidents/IncidentManager';
import { DashboardDataProvider } from './dashboard/DashboardDataProvider';
import { HealthChecker } from './health/HealthChecker';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

describe('IncidentManager', () => {
  let manager: IncidentManager;

  beforeEach(() => {
    manager = new IncidentManager();
  });

  it('creates an incident with default fields', () => {
    const inc = manager.createIncident({
      title: 'test',
      description: 'desc',
      severity: 'major',
      status: 'firing',
      source: 'test-suite',
      relatedAlertIds: [],
      tags: [],
    });
    expect(inc.id).toMatch(/^inc_/);
    expect(inc.title).toBe('test');
    expect(inc.severity).toBe('major');
    expect(inc.status).toBe('firing');
  });

  it('retrieves an incident by id', () => {
    const inc = manager.createIncident({
      title: 'find-me',
      description: '',
      severity: 'info',
      status: 'firing',
      source: 'test',
      relatedAlertIds: [],
      tags: [],
    });
    const found = manager.getIncident(inc.id);
    expect(found).toBeDefined();
    expect(found!.title).toBe('find-me');
  });

  it('returns undefined for unknown incident', () => {
    expect(manager.getIncident('ghost')).toBeUndefined();
  });

  it('updates status to acknowledged', () => {
    const inc = manager.createIncident({
      title: 'ack',
      description: '',
      severity: 'critical',
      status: 'firing',
      source: 'test',
      relatedAlertIds: [],
      tags: [],
    });
    const result = manager.updateStatus(inc.id, 'acknowledged', {
      by: 'alice',
    });
    expect(result).toBe(true);
    const updated = manager.getIncident(inc.id)!;
    expect(updated.status).toBe('acknowledged');
    expect(updated.acknowledgedBy).toBe('alice');
    expect(updated.acknowledgedAt).toBeGreaterThan(0);
  });

  it('updates status to resolved', () => {
    const inc = manager.createIncident({
      title: 'resolve',
      description: '',
      severity: 'major',
      status: 'firing',
      source: 'test',
      relatedAlertIds: [],
      tags: [],
    });
    manager.updateStatus(inc.id, 'acknowledged', { by: 'bob' });
    const result = manager.updateStatus(inc.id, 'resolved', {
      by: 'bob',
      resolution: 'fixed',
    });
    expect(result).toBe(true);
    const updated = manager.getIncident(inc.id)!;
    expect(updated.status).toBe('resolved');
    expect(updated.resolvedBy).toBe('bob');
    expect(updated.resolution).toBe('fixed');
  });

  it('returns false updating non-existent incident', () => {
    expect(manager.updateStatus('ghost', 'resolved')).toBe(false);
  });

  it('lists incidents with filters', () => {
    manager.createIncident({
      title: 'a',
      description: '',
      severity: 'critical',
      status: 'firing',
      source: 'src1',
      relatedAlertIds: [],
      tags: ['db'],
    });
    manager.createIncident({
      title: 'b',
      description: '',
      severity: 'warning',
      status: 'resolved',
      source: 'src2',
      relatedAlertIds: [],
      tags: ['cache'],
    });
    manager.createIncident({
      title: 'c',
      description: '',
      severity: 'critical',
      status: 'firing',
      source: 'src1',
      relatedAlertIds: [],
      tags: ['db'],
    });

    const criticals = manager.listIncidents({ severity: ['critical'] });
    expect(criticals.length).toBe(2);

    const resolved = manager.listIncidents({ status: ['resolved'] });
    expect(resolved.length).toBe(1);

    const bySource = manager.listIncidents({ source: 'src1' });
    expect(bySource.length).toBe(2);

    const byTag = manager.listIncidents({ tags: ['cache'] });
    expect(byTag.length).toBe(1);
  });

  it('adds related alert to incident', () => {
    const inc = manager.createIncident({
      title: 'alert-link',
      description: '',
      severity: 'minor',
      status: 'firing',
      source: 'test',
      relatedAlertIds: [],
      tags: [],
    });
    const result = manager.addRelatedAlert(inc.id, 'alert-1');
    expect(result).toBe(true);
    expect(manager.getIncident(inc.id)!.relatedAlertIds).toContain('alert-1');
  });

  it('generates stats correctly', () => {
    manager.createIncident({
      title: 'c1',
      description: '',
      severity: 'critical',
      status: 'firing',
      source: 's1',
      relatedAlertIds: [],
      tags: [],
    });
    manager.createIncident({
      title: 'c2',
      description: '',
      severity: 'critical',
      status: 'firing',
      source: 's1',
      relatedAlertIds: [],
      tags: [],
    });
    manager.createIncident({
      title: 'w1',
      description: '',
      severity: 'warning',
      status: 'resolved',
      source: 's2',
      relatedAlertIds: [],
      tags: [],
    });

    const stats = manager.getStats();
    expect(stats.total).toBe(3);
    expect(stats.bySeverity['critical']).toBe(2);
    expect(stats.bySeverity['warning']).toBe(1);
    expect(stats.byStatus['firing']).toBe(2);
    expect(stats.openCriticalCount).toBe(2);
  });

  it('closes old incidents', () => {
    const inc = manager.createIncident({
      title: 'old',
      description: '',
      severity: 'info',
      status: 'firing',
      source: 'test',
      relatedAlertIds: [],
      tags: [],
    });
    const count = manager.closeOldIncidents(0);
    expect(count).toBeGreaterThan(0);
    expect(manager.getIncident(inc.id)!.status).toBe('closed');
  });
});

describe('DashboardDataProvider', () => {
  let provider: DashboardDataProvider;

  beforeEach(() => {
    provider = new DashboardDataProvider();
  });

  it('records a data point', () => {
    provider.recordDataPoint('cpu.usage', 45);
    const series = provider.getTimeSeries('cpu.usage', 60000);
    expect(series.dataPoints.length).toBeGreaterThan(0);
  });

  it('records a batch of data points', () => {
    provider.recordBatch([
      { metric: 'cpu.usage', value: 30 },
      { metric: 'memory.used', value: 512 },
    ]);
    expect(provider.getRecentMetrics().length).toBe(2);
  });

  it('returns empty series for unknown metric', () => {
    const series = provider.getTimeSeries('nonexistent', 60000);
    expect(series.dataPoints.length).toBe(0);
  });

  it('generates widget snapshot', () => {
    provider.recordDataPoint('test.metric', 42);
    const snapshot = provider.getWidgetSnapshot({
      id: 'w1',
      title: 'Test Widget',
      type: 'stat',
      metric: 'test.metric',
      timeRange: 60000,
      refreshInterval: 5000,
    });
    expect(snapshot.widgetId).toBe('w1');
    expect(snapshot.title).toBe('Test Widget');
    expect(snapshot.summary.current).toBe(42);
    expect(snapshot.summary.count).toBeGreaterThan(0);
  });

  it('provides time range summary', () => {
    provider.recordDataPoint('metric.a', 10);
    provider.recordDataPoint('metric.b', 20);
    const summary = provider.getTimeRangeSummary(0, Date.now() + 1000);
    expect(summary.dataPoints).toBe(2);
    expect(summary.metrics).toContain('metric.a');
    expect(summary.metrics).toContain('metric.b');
  });

  it('prunes old data points', () => {
    provider.recordDataPoint('old.metric', 1);
    const pruned = provider.prune(0);
    expect(pruned).toBeGreaterThan(0);
    const series = provider.getTimeSeries('old.metric', 60000);
    expect(series.dataPoints.length).toBe(0);
  });

  it('clears all data', () => {
    provider.recordDataPoint('m1', 1);
    provider.recordDataPoint('m2', 2);
    provider.clear();
    expect(provider.getTimeRangeSummary(0, Date.now() + 1000).dataPoints).toBe(
      0
    );
  });

  it('supports different aggregation types', () => {
    for (let i = 0; i < 10; i++) {
      provider.recordDataPoint('agg.test', i);
    }
    const avg = provider.getTimeSeries('agg.test', 60000, 'avg');
    expect(avg.dataPoints.length).toBeGreaterThan(0);
    const max = provider.getTimeSeries('agg.test', 60000, 'max');
    expect(max.dataPoints.length).toBeGreaterThan(0);
  });
});

describe('HealthChecker', () => {
  let checker: HealthChecker;

  beforeEach(() => {
    checker = new HealthChecker();
  });

  afterEach(() => {
    checker.stopAutoCheck();
  });

  it('registers and runs a healthy check', async () => {
    checker.registerCheck('db', async () => ({ status: 'healthy' as const }));
    const result = await checker.runCheck('db');
    expect(result).toBeDefined();
    expect(result!.status).toBe('healthy');
    expect(result!.latency).toBeGreaterThanOrEqual(0);
  });

  it('registers and runs an unhealthy check', async () => {
    checker.registerCheck('failing', async () => {
      throw new AppError('connection refused', ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
    });
    const result = await checker.runCheck('failing');
    expect(result).toBeDefined();
    expect(result!.status).toBe('unhealthy');
    expect(result!.error).toContain('connection refused');
  });

  it('returns undefined for unknown check', async () => {
    const result = await checker.runCheck('ghost');
    expect(result).toBeUndefined();
  });

  it('unregisters a check', () => {
    checker.registerCheck('temp', async () => ({ status: 'healthy' as const }));
    const result = checker.unregisterCheck('temp');
    expect(result).toBe(true);
  });

  it('runs all checks and aggregates results', async () => {
    checker.registerCheck('a', async () => ({ status: 'healthy' as const }));
    checker.registerCheck('b', async () => ({ status: 'degraded' as const }));
    const result = await checker.runAllChecks();
    expect(result.overall).toBe('degraded');
    expect(result.summary.total).toBe(2);
    expect(result.summary.healthy).toBe(1);
    expect(result.summary.degraded).toBe(1);
  });

  it('reports unhealthy when all checks fail', async () => {
    checker.registerCheck('a', async () => {
      throw new AppError('fail', ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
    });
    checker.registerCheck('b', async () => {
      throw new AppError('fail', ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
    });
    const result = await checker.runAllChecks();
    expect(result.overall).toBe('unhealthy');
    expect(result.summary.unhealthy).toBe(2);
  });

  it('retrieves last result', async () => {
    checker.registerCheck('x', async () => ({ status: 'healthy' as const }));
    await checker.runAllChecks();
    const last = checker.getLastResult();
    expect(last).toBeDefined();
    expect(last!.overall).toBe('healthy');
  });

  it('maintains check history', async () => {
    checker.registerCheck('history', async () => ({
      status: 'healthy' as const,
    }));
    await checker.runCheck('history');
    await checker.runCheck('history');
    const history = checker.getCheckHistory('history');
    expect(history.length).toBe(2);
  });

  it('respects check timeout', async () => {
    checker.registerCheck(
      'slow',
      async () => {
        await new Promise((r) => setTimeout(r, 500));
        return { status: 'healthy' as const };
      },
      { timeout: 10 }
    );

    const result = await checker.runCheck('slow');
    expect(result!.status).toBe('unhealthy');
    expect(result!.error).toContain('超时');
  });

  it('auto-check runs periodically', async () => {
    checker.registerCheck('auto', async () => ({ status: 'healthy' as const }));
    checker.startAutoCheck(50);
    await new Promise((r) => setTimeout(r, 120));
    checker.stopAutoCheck();
    const history = checker.getCheckHistory('auto');
    expect(history.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Monitoring Integration', () => {
  it('incident manager integrates with health checker', async () => {
    const incidents = new IncidentManager();
    const health = new HealthChecker();

    health.registerCheck('critical-service', async () => {
      return { status: 'unhealthy' as const, details: { error: 'down' } };
    });

    const result = await health.runAllChecks();
    if (result.overall === 'unhealthy') {
      incidents.createIncident({
        title: '服务异常',
        description: '关键服务不可用',
        severity: 'critical',
        status: 'firing',
        source: 'health-checker',
        relatedAlertIds: [],
        tags: ['critical-service'],
      });
    }

    const stats = incidents.getStats();
    expect(stats.total).toBe(1);
    expect(stats.bySeverity['critical']).toBe(1);
  });

  it('dashboard tracks health check data', () => {
    const dashboard = new DashboardDataProvider();
    for (let i = 0; i < 5; i++) {
      dashboard.recordDataPoint('health.score', 95 + i);
      dashboard.recordDataPoint('health.latency', 10 + i);
    }

    const healthSeries = dashboard.getTimeSeries('health.score', 60000);
    expect(healthSeries.dataPoints.length).toBeGreaterThan(0);

    const snapshot = dashboard.getWidgetSnapshot({
      id: 'health-widget',
      title: '健康评分',
      type: 'line',
      metric: 'health.score',
      timeRange: 60000,
      refreshInterval: 5000,
    });
    expect(snapshot.summary.average).toBeGreaterThan(0);
    expect(snapshot.summary.count).toBeGreaterThan(0);
  });
});
