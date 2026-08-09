// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 统一格式化函数：成本、Token、百分比
// 关联文档: dev_docs/20260723/Cost_Token_Dashboard设计方案.md

/**
 * 统一成本格式化。
 * @param value    成本数值
 * @param currency 货币符号，默认 '$'
 * @param decimals 指定小数位（覆盖自动精度）。不传则自动：>=1→2位, >=0.001→4位, <0.001→6位
 */
export function formatCost(
  value: number | undefined | null,
  currency = "$",
  decimals?: number,
): string {
  if (value == null) return `${currency}0.00`;
  if (decimals !== undefined) return `${currency}${value.toFixed(decimals)}`;
  if (value >= 1) return `${currency}${value.toFixed(2)}`;
  if (value >= 0.001) return `${currency}${value.toFixed(4)}`;
  return `${currency}${value.toFixed(6)}`;
}

/**
 * 统一 Token 数量格式化。locale='zh' 时使用万/千单位。
 */
export function formatTokens(
  value: number | undefined | null,
  locale?: "en" | "zh",
): string {
  if (value == null) return "0";
  if (locale === "zh") {
    if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}千`;
    return value.toLocaleString("zh-CN");
  }
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}

/**
 * 统一百分比格式化（0-1 → "12.3%"）
 */
export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

// ── 时区 → 货币符号映射 ──

const TIMEZONE_CURRENCY_MAP: Record<string, string> = {
  "Asia/Shanghai": "¥",
  "Asia/Tokyo": "¥",
  "Asia/Seoul": "₩",
  "Asia/Singapore": "S$",
  "Asia/Kolkata": "₹",
  "Asia/Dubai": "د.إ",
  "Europe/London": "£",
  "Europe/Paris": "€",
  "Europe/Berlin": "€",
  "Europe/Moscow": "₽",
  "America/New_York": "$",
  "America/Chicago": "$",
  "America/Los_Angeles": "$",
  "America/Sao_Paulo": "R$",
  "Australia/Sydney": "A$",
  "Pacific/Auckland": "NZ$",
  UTC: "$",
};

/**
 * 根据当前用户配置的时区推导货币符号。
 * 仅覆盖 Settings 中 TIMEZONE_OPTIONS 的 17 个时区，未覆盖返回 '$'。
 */
export function getCurrencyFromTimezone(timezone: string): string {
  return TIMEZONE_CURRENCY_MAP[timezone] || "$";
}

// ── 文件大小格式化（由 formatFileSize.ts 归并） ──

/**
 * 文件大小格式化工具。
 * 将字节数转换为人类可读的大小表示。
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── 相对时间格式化（由 formatTime.ts 归并） ──

/**
 * 将日期字符串转为用户友好的相对时间显示：
 * - 今天 → HH:MM
 * - 昨天 → "昨天"
 * - 7天内 → "X天前"
 * - 更早 → "X月X日"
 */
export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  if (diffDays === 1) return "昨天";
  if (diffDays < 7) return `${diffDays}天前`;
  return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

// ── 文件读取（由 fileUtils.ts 归并） ──

/**
 * 将 File 对象读取为 Base64 字符串（不含 data:xxx;base64, 前缀）
 */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = () => reject(new Error(`读取文件失败: ${file.name}`));
    reader.readAsDataURL(file);
  });
}
