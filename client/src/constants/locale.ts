/**
 * 语言 / 时区（硬编码治理 `HD-P1-2` **A9**）。
 *
 * **背景（方案 §2.5）**：默认语言/时区原先**自相矛盾**（后端 `en-US`/`UTC` vs `LanguageManager` 的 `zh-CN`）。
 * **裁定（`Q-H2`，2026-10-13 用户确认）**：默认口径统一为 **`zh-CN` / `Asia/Shanghai`**
 * （理由：国内渠道占多数 + i18n 默认 `zh` + 语音默认 `zh-CN`）；后端已落地
 * `app/src/constants/common.ts` 的 `DEFAULT_LOCALE`/`DEFAULT_TIMEZONE`。
 *
 * **本文件是客户端侧的对应真源**：
 * - **语言**不在此定义 —— 客户端语言的唯一真源是 **`i18n`**（`lng: getSavedLanguage()`，`fallbackLng: "zh"`）；
 *   需要 BCP-47 区域码时用 `utils/format.ts` 的 **`currentLocale()`**（随语言切换）。
 * - **时区**：`config.timezone` 缺省时回落到 `DEFAULT_TIMEZONE`（与后端同值）。
 *
 * ⚠️ **不得**再在组件里写死 `"Asia/Shanghai"`（应引用本常量）或 `"zh-CN"`（应引用 `currentLocale()`）。
 */

/**
 * 默认语言（BCP-47）—— 与后端 `DEFAULT_LOCALE` **同值**（`Q-H2` 裁定口径）。
 *
 * ⚠️ **区分两个用途**：
 * - **界面日期/数字格式化** ⇒ 用 `utils/format.ts` 的 `currentLocale()`（**随 UI 语言切换**）；
 * - **「产品默认语言」本身**（如 STT 识别语言、配置缺省项）⇒ 用本常量。
 */
export const DEFAULT_LOCALE = "zh-CN";

/** 默认时区（IANA）—— 与后端 `DEFAULT_TIMEZONE` **同值**（`Q-H2` 裁定口径）。 */
export const DEFAULT_TIMEZONE = "Asia/Shanghai";
