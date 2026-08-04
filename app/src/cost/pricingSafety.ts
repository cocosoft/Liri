// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 定价安全函数
 *
 * 防止异常数据（负值/NaN/Infinity/异常大值）导致成本虚高或虚低。
 * 参考 codeburn-main `src/models.ts` 的 safePerTokenRate / safe 实现。
 */

/**
 * 安全 token 数：拒绝负/NaN/Infinity，钳制为 0
 */
export function safeTokens(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * 安全每 token 定价（USD）：
 * - 拒绝 undefined/null
 * - 拒绝负/NaN/Infinity
 * - 上限 $1/token（防小数点错位成本虚高，参考 codeburn）
 * - 返回 null 表示不可用
 */
export function safePerTokenRate(n: number | undefined | null): number {
  if (n === undefined || n === null || !Number.isFinite(n) || n < 0) {
    return 0;
  }
  // 上限 $1/token — 远超高最昂贵模型，防上游 JSON 小数点错位
  if (n > 1) {
    return 1;
  }
  return n;
}

/**
 * 安全模型名：剥离控制字符，截断过长的名称
 * 参考 codeburn: model.replace(/[\x00-\x1F\x7F-\x9F]/g, '?').slice(0, 200)
 */
export function safeModelName(name: string): string {
  if (!name || typeof name !== 'string') return '<unknown>';
  return name.replace(/[\x00-\x1F\x7F-\x9F]/g, '?').slice(0, 200);
}
