/**
 * Registry 时间格式化（P2-2，2026-09-07）
 *
 * FileRegistry 的 createdAt/updatedAt 为**秒级**（SQLite `strftime('%s')`）。
 * 所有展示必须经本函数换算（*1000），避免调用方直接 `new Date(ts)` 落入 1970 陷阱。
 */
export function formatRegistryTime(
  tsSec?: number,
  options?: { withSeconds?: boolean },
): string {
  if (!tsSec || tsSec <= 0) return "";
  return new Date(tsSec * 1000).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...(options?.withSeconds ? { second: "2-digit" as const } : {}),
  });
}
