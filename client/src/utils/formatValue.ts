/**
 * 参数值格式化工具
 *
 * 根据参数键名和值类型，返回用户友好的展示文本：
 * - 布尔值 → "是"/"否"
 * - 时间相关数字 → 毫秒/秒/分钟
 * - 大小相关数字 → 字符/KB/MB
 * - URL → 提取域名+路径
 * - 长文本 → 截断
 * - 数组 → 列表展示
 * - 对象 → JSON 字符串
 */

/**
 * 格式化参数值，根据类型返回更友好的展示
 */
export function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined) {
    return "无";
  }

  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }

  if (typeof value === "number") {
    if (
      key.toLowerCase().includes("time") ||
      key.toLowerCase().includes("duration")
    ) {
      if (value < 1000) return `${value} 毫秒`;
      if (value < 60000) return `${(value / 1000).toFixed(1)} 秒`;
      return `${(value / 60000).toFixed(1)} 分钟`;
    }
    if (
      key.toLowerCase().includes("length") ||
      key.toLowerCase().includes("size")
    ) {
      if (value < 1024) return `${value} 字符`;
      if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
      return `${(value / 1024 / 1024).toFixed(1)} MB`;
    }
    if (
      key.toLowerCase().includes("count") ||
      key.toLowerCase().includes("limit")
    ) {
      return `${value}`;
    }
    return `${value}`;
  }

  if (typeof value === "string") {
    if (key === "url" || key === "link" || key === "href") {
      try {
        const url = new URL(value);
        return url.hostname + (url.pathname !== "/" ? url.pathname : "");
      } catch {
        return value.length > 60 ? value.substring(0, 60) + "..." : value;
      }
    }
    if (value.length > 200) {
      return value.substring(0, 200) + "...";
    }
    return value;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return "（空列表）";
    if (value.length <= 3) {
      return value.map((v, i) => `${i + 1}. ${formatValue(key, v)}`).join("\n");
    }
    return `共 ${value.length} 项：\n${value
      .slice(0, 3)
      .map((v, i) => `${i + 1}. ${formatValue(key, v)}`)
      .join("\n")}\n...`;
  }

  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }

  return String(value);
}