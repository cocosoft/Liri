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
  currency = '$',
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
export function formatTokens(value: number | undefined | null, locale?: 'en' | 'zh'): string {
  if (value == null) return '0';
  if (locale === 'zh') {
    if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}千`;
    return value.toLocaleString('zh-CN');
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
  'Asia/Shanghai': '¥',
  'Asia/Tokyo': '¥',
  'Asia/Seoul': '₩',
  'Asia/Singapore': 'S$',
  'Asia/Kolkata': '₹',
  'Asia/Dubai': 'د.إ',
  'Europe/London': '£',
  'Europe/Paris': '€',
  'Europe/Berlin': '€',
  'Europe/Moscow': '₽',
  'America/New_York': '$',
  'America/Chicago': '$',
  'America/Los_Angeles': '$',
  'America/Sao_Paulo': 'R$',
  'Australia/Sydney': 'A$',
  'Pacific/Auckland': 'NZ$',
  'UTC': '$',
};

/**
 * 根据当前用户配置的时区推导货币符号。
 * 仅覆盖 Settings 中 TIMEZONE_OPTIONS 的 17 个时区，未覆盖返回 '$'。
 */
export function getCurrencyFromTimezone(timezone: string): string {
  return TIMEZONE_CURRENCY_MAP[timezone] || '$';
}
