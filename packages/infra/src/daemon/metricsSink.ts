/**
 * daemon 的**指标上报端口**（2026-11-01 B5 解环）
 *
 * 背景：`daemon/ProcessManager.ts` 曾直接 `import { getMonitoringService } from '@openliri/infra/monitoring'`
 * 上报进程数 / 健康检查指标，而 `monitoring` 又（经 config / utils 等）可达 `daemon`
 * ⇒ 二者同处 infra 的强连通分量（R7 环成员）。解环做法与 `constants` 的
 * `setFrozenSnapshotUnfreezer` 一致：daemon 只声明端口，实现由 app 启动期注入
 * （`bootstrap/preflight.wireDaemonDeps`）。
 *
 * 未注入 ⇒ 静默跳过：与既有实现"MonitoringService 不可用则在 try/catch 里跳过上报"的
 * 降级语义一致（守护进程不因监控缺席而失败）。
 */
export type DaemonMetricsSink = (name: string, value: number) => void;

let sink: DaemonMetricsSink | null = null;

/** 注入指标上报实现（返回 disposer） */
export function setDaemonMetricsSink(
  next: DaemonMetricsSink | null
): () => void {
  const previous = sink;
  sink = next;
  return () => {
    sink = previous;
  };
}

/** 上报一个 daemon 指标（未注入 ⇒ 跳过） */
export function reportDaemonMetric(name: string, value: number): void {
  if (!sink) return;
  try {
    sink(name, value);
  } catch {
    // 监控服务不可用不影响守护进程（与历史实现同语义）
  }
}
