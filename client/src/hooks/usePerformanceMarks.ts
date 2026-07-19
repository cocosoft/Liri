/**
 * 办公模块性能埋点 hook（v6）
 * 封装 performance.mark/measure，便于关键路径耗时监控
 */

/**
 * 创建性能标记并返回 stop 函数
 * 用法：const done = markStart('doc-load'); ... await download(); const elapsed = done();
 */
export function markStart(label: string): () => number {
  const startMark = `${label}-start`;
  const endMark = `${label}-end`;

  performance.mark(startMark);

  return () => {
    performance.mark(endMark);
    try {
      performance.measure(label, startMark, endMark);
    } catch {
      // measure 失败不阻塞（如重复标记）
    }
    const entry = performance.getEntriesByName(label, "measure")[0];
    return entry ? entry.duration : 0;
  };
}

/**
 * 获取所有已记录的 office 性能指标
 */
export function getOfficePerfMetrics(): Array<{
  name: string;
  duration: number;
}> {
  const measures = performance.getEntriesByType("measure");
  return measures
    .filter((m) => m.name.startsWith("doc-"))
    .map((m) => ({ name: m.name, duration: m.duration }));
}
