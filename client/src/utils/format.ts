// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 统一格式化函数：成本、Token、百分比
// 关联文档: dev_docs/20260723/Cost_Token_Dashboard设计方案.md

// HD-P2-2：相对时间文案走 i18n（工具函数不能用 hook ⇒ 直接用 i18n 实例）
import i18n from "../i18n";

/**
 * 日预算**金额（USD）**展示 —— 与后端 `dailyBudgetSnapshot.ts#formatUsdAmount`
 * **逐字同口径**（跨部署契约：最少 2 位、最多 4 位小数；**有意 `en-US`**，金额属货币口径而非 UI 语言）。
 *
 * 与 `formatCost` 的区别：本函数保留**千分位**（`$1,234.50`），后端快照/撞限卡片文案同款。
 * 单侧改动会破坏两侧一致性 —— 改这里必须同步改后端。
 */
export function formatUsdAmount(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })}`;
}

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
    return value.toLocaleString(currentLocale());
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
 * 当前语言的 BCP-47 locale（i18n 语言码 → 区域码）。
 *
 * 硬编码治理 `HD-P2-2`：原实现把时间/日期格式**写死 `zh-CN`** ⇒ 英文界面下也按中文区域输出。
 *
 * 硬编码治理 `HD-P1-2` **A9**：本函数**导出**为**客户端唯一真源** —— 其它模块一律引用它，
 * **不得**再写死 `"zh-CN"` / `"en-US"`（`Q-H2` 已裁定默认口径 `zh-CN`/`Asia/Shanghai`）。
 */
export function currentLocale(): string {
  const lang = i18n.language || "zh";
  if (lang.startsWith("zh")) return "zh-CN";
  if (lang.startsWith("en")) return "en-US";
  return lang;
}

/**
 * 将日期字符串转为用户友好的相对时间显示：
 * - 今天 → HH:MM
 * - 昨天 → `common.timeYesterday`
 * - 7天内 → `common.timeDaysAgo`
 * - 更早 → 月/日（按**当前语言**的区域格式）
 *
 * ⚠️ 硬编码治理 `HD-P2-2`：原实现把文案（`"昨天"` / `` `${n}天前` ``）与
 * `toLocaleTimeString("zh-CN")` / `toLocaleDateString("zh-CN")` 一并写死
 * ⇒ **英文界面下仍显示中文与中文日期格式**。现：文案走 i18n，时间/日期格式走 `currentLocale()`。
 */
export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString(currentLocale(), {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  if (diffDays === 1) return i18n.t("common.timeYesterday");
  if (diffDays < 7) return i18n.t("common.timeDaysAgo", { days: diffDays });
  return date.toLocaleDateString(currentLocale(), {
    month: "short",
    day: "numeric",
  });
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
    reader.onerror = () =>
      reject(new Error(i18n.t("files.readFileFailed", { name: file.name })));
    reader.readAsDataURL(file);
  });
}
