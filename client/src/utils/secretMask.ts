/**
 * 凭证脱敏工具函数
 * 对标 OpenClaw channel-management store 的 secret 管理
 */

/** 对密钥值进行脱敏显示：前段固定 8 个 •，末尾保留 4 位 */
export function maskSecretValue(value: unknown): string {
  if (!value || typeof value !== "string") return "";
  if (value.length <= 8) return "\u2022".repeat(8);
  return "\u2022".repeat(8) + value.slice(-4);
}

/**
 * 判断用户是否修改了密钥值
 * currentInput 为空时视为未修改
 */
export function isSecretChanged(
  originalValue: unknown,
  currentInput: string,
): boolean {
  if (!currentInput) return false;
  if (!originalValue || typeof originalValue !== "string") return true;
  return currentInput !== originalValue;
}

/**
 * 过滤异常值：如果输入为脱敏占位符则不视为有效输入
 */
export function normalizeSecretInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  // 如果用户输入的是全占位符，视为未修改
  if (/^\u2022{4,}$/.test(trimmed)) return null;
  return trimmed;
}
