/**
 * PermissionMetricsStore — 权限监测指标内存快照（进程内可查询）
 *
 * OTel Metrics 为 Push 模型（PeriodicExportingMetricReader → Console），
 * 无法通过 HTTP 按需查询 Counter 当前值。本 store 作为可查询的轻量快照，
 * 与 OTel counter 同步记录（同一次 record 双写），供 /v1/permissions/metrics 消费。
 */

export interface PermissionMetricPoint {
  category: string;
  labels: Record<string, string>;
  count: number;
}

export class PermissionMetricsStore {
  private counts = new Map<string, number>();

  /** 记录一次指标（category + labels 聚合计数） */
  record(category: string, labels: Record<string, string>): void {
    const key = this.buildKey(category, labels);
    this.counts.set(key, (this.counts.get(key) || 0) + 1);
  }

  /** 当前快照（进程内累计，重启清零） */
  snapshot(): PermissionMetricPoint[] {
    return Array.from(this.counts.entries()).map(([key, count]) => {
      const sep = key.indexOf('|');
      const category = sep === -1 ? key : key.slice(0, sep);
      const labels: Record<string, string> = {};
      if (sep !== -1) {
        for (const pair of key.slice(sep + 1).split(',')) {
          const eq = pair.indexOf('=');
          if (eq > 0) labels[pair.slice(0, eq)] = pair.slice(eq + 1);
        }
      }
      return { category, labels, count };
    });
  }

  clear(): void {
    this.counts.clear();
  }

  private buildKey(category: string, labels: Record<string, string>): string {
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    return labelStr ? `${category}|${labelStr}` : category;
  }
}

/** 全局单例（与 denialTracker 等单例同生命周期） */
export const permissionMetrics = new PermissionMetricsStore();
